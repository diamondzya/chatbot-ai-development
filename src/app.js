import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { config, publicHealthConfig } from './config/index.js';
import { SUGGESTED_QUESTIONS } from './config/handbook.js';
import { HttpError } from './errors.js';
import chatRoutes, { apiLimiter } from './routes/chat.js';
import { getAttachmentStats } from './services/attachments.js';
import { ProviderError } from './services/aiProvider.js';
import { getIndexMeta, getTableOfContents } from './services/handbookSearch.js';

const DISCLAIMER =
  'STI Assist AI is an unofficial prototype. It is not affiliated with or endorsed by STI. Answers are generated from the STI High School Student Handbook (July 2026) and may contain errors. Always confirm important policies with your school office.';

const START_HERE = [
  'What should I do if I forget my school ID?',
  'What are the rules about being late to class?',
  'Can I use my phone during class?',
  'What are the uniform requirements?',
  'What should I do if I lose something at school?',
  'Where can I find the school’s disciplinary policies?',
];

// Warns when the handbook PDF has changed since the index was built, which is
// when cited page numbers can drift away from the actual document.
async function indexFreshness() {
  let meta = null;
  try {
    meta = await getIndexMeta();
  } catch {
    return { ready: false };
  }
  let stat = null;
  try {
    stat = fs.statSync(config.handbookPath);
  } catch {
    stat = null;
  }
  const indexedAtMs = Date.parse(meta?.generatedAt || '') || null;
  let stale = null;
  if (stat && meta?.sourcePdf) {
    // Exact comparison when the index recorded the source file it was built from.
    stale =
      stat.size !== meta.sourcePdf.size ||
      new Date(stat.mtimeMs).toISOString() !== meta.sourcePdf.modifiedAt;
  } else if (stat && indexedAtMs !== null) {
    // Older indexes only have a build timestamp to compare against.
    stale = stat.mtimeMs > indexedAtMs + 1000;
  }
  return {
    ready: true,
    chunks: meta.chunks,
    sections: meta.sections,
    generatedAt: meta.generatedAt,
    pages: meta.indexedPrintedPages,
    handbookModifiedAt: stat !== null ? new Date(stat.mtimeMs).toISOString() : null,
    stale,
  };
}

function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.host === req.get('host');
  } catch {
    return false;
  }
}

function requestLogger(req, res, next) {
  if (config.logLevel === 'silent' || process.env.NODE_ENV === 'test') return next();
  const started = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) return;
    const entry = {
      level: 'info',
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started,
    };
    if (res.statusCode >= 500) entry.level = 'error';
    else if (res.statusCode >= 400) entry.level = 'warn';
    console.log(JSON.stringify(entry));
  });
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    req.id = randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'none'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          manifestSrc: ["'self'"],
          ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  app.use(
    compression({
      // SSE responses set "Cache-Control: no-transform", so compression skips
      // them and the token stream stays unbuffered.
      threshold: 1024,
    })
  );

  app.use((_req, res, next) => {
    // Voice input needs the microphone on this origin; everything else is off.
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(self), geolocation=(), payment=(), usb=()'
    );
    next();
  });

  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !sameOrigin(req)) {
      return next(new HttpError(403, 'cross_origin_blocked', 'Cross-origin requests are not allowed.'));
    }
    return next();
  });

  app.use(requestLogger);
  app.use(express.json({ limit: config.limits.maxJsonBody, strict: true }));

  app.use(
    express.static(config.publicDir, {
      index: 'index.html',
      etag: true,
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders(res, filePath) {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  if (config.handbookPdf.serve) {
    // Serves the indexed handbook so source cards can deep-link to a cited
    // page (`/handbook.pdf#page=40`). It is the same document the answers are
    // grounded in, but it is the whole PDF — set SERVE_HANDBOOK_PDF=false when
    // the deployment should not redistribute it.
    app.get(config.handbookPdf.publicUrl, (req, res, next) => {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${path
          .basename(config.handbookPath)
          .replace(/["\\]/g, '')}"`,
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'private, max-age=3600',
      });
      res.sendFile(
        config.handbookPath,
        { acceptRanges: true, etag: true, lastModified: true },
        (error) => {
          if (!error) return;
          if (res.headersSent) {
            // The PDF started transferring before the read failed; destroy the
            // socket so a truncated file is never presented as complete.
            res.destroy();
            return;
          }
          next(
            new HttpError(
              404,
              'handbook_pdf_unavailable',
              'The handbook PDF is not available on this server.'
            )
          );
        }
      );
    });
  }

  app.get('/api/health', async (_req, res) => {
    const index = await indexFreshness();
    res.json({
      status: 'ok',
      version: config.appVersion,
      uptimeSeconds: Math.round(process.uptime()),
      mode: config.features.demoMode ? 'demo' : 'ai',
      index,
      attachments: getAttachmentStats(),
    });
  });

  app.get('/api/meta', apiLimiter, async (_req, res) => {
    let handbook = null;
    try {
      const [meta, freshness] = await Promise.all([getIndexMeta(), indexFreshness()]);
      handbook = {
        title: meta.title,
        edition: meta.edition,
        published: meta.published,
        campus: meta.campus,
        applicability: meta.applicability,
        officialStatus: meta.officialStatus,
        pagesIndexed: meta.indexedPrintedPages,
        pageOffsetNote: meta.pageOffsetNote,
        chunks: meta.chunks,
        sections: meta.sections,
        generatedAt: meta.generatedAt,
        // True when the PDF on disk is newer than the index built from it;
        // citations may have drifted until `npm run index` is rerun.
        stale: freshness.stale,
        openUrl: config.handbookPdf.serve ? config.handbookPdf.publicUrl : null,
        pdfPageOffset: config.handbookPdf.pdfPageOffset,
      };
    } catch {
      handbook = null;
    }

    res.json({
      app: {
        name: config.appName,
        version: config.appVersion,
        disclaimer: DISCLAIMER,
        unofficial: true,
      },
      mode: {
        demo: config.features.demoMode,
        aiGenerated: !config.features.demoMode,
        label: config.features.demoMode
          ? 'Local retrieval demo — not AI'
          : 'AI answers enabled',
      },
      provider: publicHealthConfig(),
      handbook,
      startHere: START_HERE,
      suggestedQuestions: SUGGESTED_QUESTIONS,
      limits: {
        maxMessageChars: config.limits.maxMessageChars,
        maxImageMb: config.limits.maxImageMb,
        maxHistoryMessages: config.limits.maxHistoryMessages,
        attachmentTtlMinutes: Math.round(config.attachments.ttlMs / 60000),
        allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
    });
  });

  app.get('/api/handbook/sections', apiLimiter, async (_req, res) => {
    const toc = await getTableOfContents();
    res.set('Cache-Control', 'private, max-age=300');
    res.json(toc);
  });

  app.use('/api', apiLimiter, chatRoutes);

  app.use('/api', (_req, _res, next) => {
    next(new HttpError(404, 'not_found', 'That API endpoint does not exist.'));
  });

  app.use((req, res, next) => {
    if (req.method !== 'GET' || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use((_req, _res, next) => {
    next(new HttpError(404, 'not_found', 'The page you requested was not found.'));
  });

  app.use((error, req, res, _next) => {
    let status = 500;
    let code = 'internal_error';
    let message = 'Something went wrong on the server. Please try again.';

    if (error instanceof HttpError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof ProviderError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error?.type === 'entity.too.large') {
      status = 413;
      code = 'request_too_large';
      message = 'The request is too large. Shorten your message or upload a smaller image.';
    } else if (error instanceof SyntaxError && 'body' in error) {
      status = 400;
      code = 'invalid_json';
      message = 'The request body was not valid JSON.';
    } else if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
      status = error.status;
      code = 'bad_request';
      message = 'The request could not be processed.';
    }

    if (status >= 500) {
      console.error(
        JSON.stringify({
          level: 'error',
          requestId: req.id,
          code,
          name: error?.name || 'Error',
          message: error?.message || 'unknown error',
          stack: config.isProduction ? undefined : error?.stack,
        })
      );
      if (config.isProduction && !error?.expose) {
        message = 'Something went wrong on the server. Please try again.';
      } else if (error?.expose && error.message) {
        message = error.message;
      }
    } else if (status === 429 || status === 403) {
      console.warn(JSON.stringify({ level: 'warn', requestId: req.id, code, status }));
    }

    if (res.headersSent) return;
    res.status(status).json({
      error: {
        code,
        message,
        requestId: req.id,
      },
    });
  });

  return app;
}
