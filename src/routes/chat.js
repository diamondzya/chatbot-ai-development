import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { HttpError } from '../errors.js';
import { ProviderError } from '../services/aiProvider.js';
import { deleteAttachment, validateAndStoreImage } from '../services/attachments.js';
import { handleChat } from '../services/chatService.js';
import { recordFeedback, validateFeedback } from '../services/feedback.js';

const router = express.Router();

// multer is imported lazily: the module is only loaded when image uploads are
// actually enabled. On Cloudflare Workers uploads are disabled by default
// (in-memory storage is not reliable there), so multer is never executed.
let multerPromise = null;
function loadMulter() {
  // multer is CommonJS: unwrap the module namespace so the returned value is
  // the callable multer export (with .memoryStorage and .MulterError).
  if (!multerPromise) multerPromise = import('multer').then((mod) => mod.default || mod);
  return multerPromise;
}

const IMAGE_UPLOADS_DISABLED_MESSAGE =
  'Image uploads are not available on this deployment. Please type your question instead — handbook answers do not need the image.';

function limiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message,
        },
      });
    },
  });
}

export const apiLimiter = limiter({
  windowMs: config.rateLimits.apiWindowMs,
  limit: config.rateLimits.apiLimit,
  message: 'Too many requests from this connection. Please wait a minute and try again.',
});

const chatLimiter = limiter({
  windowMs: config.rateLimits.chatWindowMs,
  limit: config.rateLimits.chatLimit,
  message: 'You are sending messages too quickly. Please wait a moment and try again.',
});

const uploadLimiter = limiter({
  windowMs: config.rateLimits.attachmentWindowMs,
  limit: config.rateLimits.attachmentLimit,
  message: 'Too many image uploads. Please wait a few minutes and try again.',
});

const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;

function ownerKeyFor(req) {
  const header = req.get('x-client-id');
  const clientId = typeof header === 'string' && CLIENT_ID.test(header) ? header : '';
  // Bind temporary images to both the browser-generated ID and the request IP
  // so a guessed ID cannot retrieve another connection's upload.
  return clientId ? `${clientId}|${req.ip}` : `ip|${req.ip}`;
}

async function receiveImage(req, res, next) {
  let multer;
  try {
    multer = await loadMulter();
  } catch {
    return next(new HttpError(503, 'image_uploads_unavailable', IMAGE_UPLOADS_DISABLED_MESSAGE));
  }
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.limits.maxImageBytes,
      files: 1,
      fields: 4,
      parts: 6,
    },
  });
  upload.single('image')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(
          new HttpError(
            413,
            'image_too_large',
            `The image is larger than the ${config.limits.maxImageMb} MB limit.`
          )
        );
      }
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(
          new HttpError(400, 'invalid_upload', 'Upload exactly one image in the "image" field.')
        );
      }
      return next(new HttpError(400, 'invalid_upload', 'The upload could not be processed.'));
    }
    return next(error);
  });
}

function normaliseHistory(history) {
  if (history === undefined || history === null) return [];
  if (!Array.isArray(history)) {
    throw new HttpError(400, 'invalid_history', 'The conversation history must be a list.');
  }
  if (history.length > 12) {
    throw new HttpError(400, 'invalid_history', 'The conversation history is too long.');
  }
  return history.map((turn) => {
    if (!turn || typeof turn !== 'object') {
      throw new HttpError(400, 'invalid_history', 'The conversation history is malformed.');
    }
    const role = turn.role;
    const content = typeof turn.content === 'string' ? turn.content.trim() : '';
    if ((role !== 'user' && role !== 'assistant') || !content) {
      throw new HttpError(400, 'invalid_history', 'The conversation history is malformed.');
    }
    if (content.length > 4000) {
      throw new HttpError(400, 'invalid_history', 'A history message is too long.');
    }
    return { role, content };
  });
}

function readChatRequest(req) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Send a JSON object with a "message" field.');
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    throw new HttpError(400, 'empty_message', 'Please type a question about school rules or campus concerns.');
  }
  if (message.length > config.limits.maxMessageChars) {
    throw new HttpError(
      400,
      'message_too_long',
      `Please keep your question under ${config.limits.maxMessageChars} characters.`
    );
  }
  if (message.includes('\u0000')) {
    throw new HttpError(400, 'invalid_message', 'The message contains unsupported characters.');
  }

  let attachmentId = null;
  if (body.attachmentId !== undefined && body.attachmentId !== null) {
    if (typeof body.attachmentId !== 'string' || body.attachmentId.length > 64) {
      throw new HttpError(400, 'invalid_attachment_id', 'The image reference is not valid.');
    }
    attachmentId = body.attachmentId;
  }

  // "Handbook only" is an explicit student choice: return retrieved excerpts
  // even when an AI provider is configured.
  let preferExcerpts = false;
  if (body.preferExcerpts !== undefined && body.preferExcerpts !== null) {
    if (typeof body.preferExcerpts !== 'boolean') {
      throw new HttpError(
        400,
        'invalid_preference',
        'The "preferExcerpts" field must be true or false.'
      );
    }
    preferExcerpts = body.preferExcerpts;
  }

  return {
    message,
    history: normaliseHistory(body.history),
    attachmentId,
    preferExcerpts,
    ownerKey: ownerKeyFor(req),
  };
}

function writeSse(res, event, data) {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function streamErrorPayload(error) {
  if (error instanceof HttpError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return {
    code: 'internal_error',
    message: 'Something went wrong while preparing the answer. Please try again.',
    status: 500,
  };
}

router.post('/chat', chatLimiter, async (req, res) => {
  const result = await handleChat(readChatRequest(req));
  res.set('Cache-Control', 'no-store');
  res.json({ ...result, requestId: req.id });
});

router.post('/chat/stream', chatLimiter, async (req, res) => {
  // Validate before switching to SSE so malformed requests still get a normal
  // JSON error with an HTTP status.
  const input = readChatRequest(req);

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const abort = new AbortController();
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      abort.abort();
    }
  });

  // Proxies and load balancers sometimes drop a quiet connection. Comments keep
  // it alive without polluting the event stream.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        // The connection is gone; the close handler will clean up.
      }
    }
  }, 15000);
  heartbeat.unref?.();

  try {
    const result = await handleChat({
      ...input,
      signal: abort.signal,
      onStreamStart: (payload) => writeSse(res, 'sources', payload),
      onDelta: (text) => writeSse(res, 'delta', { text }),
    });
    writeSse(res, 'done', { ...result, requestId: req.id });
  } catch (error) {
    if (!clientGone && !abort.signal.aborted) {
      const payload = streamErrorPayload(error);
      if (payload.status >= 500) {
        console.error(
          JSON.stringify({
            level: 'error',
            requestId: req.id,
            code: payload.code,
            name: error?.name || 'Error',
            message: error?.message || 'unknown error',
            stack: config.isProduction ? undefined : error?.stack,
          })
        );
      }
      writeSse(res, 'error', { error: { ...payload, requestId: req.id } });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
});

router.post('/feedback', apiLimiter, (req, res) => {
  // Anonymous verdict counters only: no message text, no client identifiers.
  const feedback = validateFeedback(req.body);
  recordFeedback(feedback);
  res.status(202).json({ recorded: true });
});

router.post(
  '/attachments',
  uploadLimiter,
  (req, res, next) => {
    // Cloudflare Workers: the in-memory attachment store (with its TTL timer
    // and per-isolate lifetime) cannot be relied on, so uploads are disabled
    // with an explicit message. Local development keeps full upload support.
    if (!config.features.imageUploads) {
      // Answered directly (like the rate limiter) so a deliberate refusal is
      // not logged as a server error.
      return res.status(501).json({
        error: {
          code: 'image_uploads_unavailable',
          message: IMAGE_UPLOADS_DISABLED_MESSAGE,
          requestId: req.id,
        },
      });
    }
    return receiveImage(req, res, next);
  },
  async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, 'missing_image', 'Choose an image to upload in the "image" field.');
    }
    const attachment = await validateAndStoreImage({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      ownerKey: ownerKeyFor(req),
    });
    res.status(201).json({ attachment });
  }
);

router.delete('/attachments/:id', apiLimiter, (req, res) => {
  const deleted = deleteAttachment(req.params.id, ownerKeyFor(req));
  if (!deleted) {
    throw new HttpError(
      404,
      'attachment_not_found',
      'That image was not found or has already been removed.'
    );
  }
  res.status(204).end();
});

export default router;
