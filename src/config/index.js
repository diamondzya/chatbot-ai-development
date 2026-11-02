import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// The Cloudflare Workers runtime identifies itself through navigator.userAgent.
// WORKER_PLATFORM exists so tests and the KV upload script can force the same
// code paths without a Workers runtime.
function detectWorkerPlatform() {
  const override = String(process.env.WORKER_PLATFORM || '')
    .trim()
    .toLowerCase();
  if (override === '1' || override === 'true') return true;
  if (override === '0' || override === 'false') return false;
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

export const isWorkerPlatform = detectWorkerPlatform();

let rootDir = '/bundle';
try {
  // Under Wrangler this points inside the worker bundle; locally it is the
  // project root. It is only used to build local filesystem paths, and the
  // Worker never reads those files.
  rootDir = fileURLToPath(new URL('../../', import.meta.url));
} catch {
  rootDir = process.cwd();
}

if (!isWorkerPlatform) {
  // Workers receive configuration through bindings (process.env is populated
  // automatically), and have no .env file to load.
  dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });
}

function intEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}: expected an integer between ${min} and ${max}.`);
  }
  return value;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normaliseBaseUrl(raw) {
  const value = clean(raw).replace(/\/+$/, '');
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('AI_BASE_URL / EMBEDDING_BASE_URL must be a valid URL.');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Provider base URLs must use HTTPS (HTTP is allowed only for localhost testing).');
  }
  return value;
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

const provider = clean(process.env.AI_PROVIDER).toLowerCase() || 'nvidia';
if (!['nvidia', 'openai-compatible'].includes(provider)) {
  throw new Error('AI_PROVIDER must be "nvidia" or "openai-compatible".');
}

const apiKey = clean(process.env.AI_API_KEY);
const apiKeyLooksReal = apiKey !== '' && !/^replace/i.test(apiKey);
const baseUrl = normaliseBaseUrl(process.env.AI_BASE_URL || 'https://integrate.api.nvidia.com/v1');
// Live-verified default (2026-11-01): DeepSeek V4.1 Flash via NVIDIA NIM.
// It is a reasoning-style model: hidden `reasoning_content` arrives first
// (~7 s) before the visible stream starts, but answers stay inside the
// 900-token budget; a rare reasoning-budget exhaustion still hits the
// output_truncated retry path.
const model = clean(process.env.AI_MODEL) || 'deepseek-ai/deepseek-v4.1-flash';
// Live-verified default: the 11B Llama vision model is listed in NVIDIA's
// catalogue but is not deployed for every account (404), while the Nemotron
// VL model answered correctly in testing.
const visionModel =
  clean(process.env.AI_VISION_MODEL) || 'nvidia/nemotron-3.5-super-vl-120b-a12b';

const embeddingProvider = (clean(process.env.EMBEDDING_PROVIDER) || 'local').toLowerCase();
if (!['local', 'nvidia'].includes(embeddingProvider)) {
  throw new Error('EMBEDDING_PROVIDER must be "local" or "nvidia".');
}

const embeddingApiKey = clean(process.env.EMBEDDING_API_KEY) || apiKey;
const localEmbeddingModel =
  clean(process.env.LOCAL_EMBEDDING_MODEL) || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

const maxImageMb = intEnv('MAX_IMAGE_MB', 6, { min: 1, max: 20 });

export const config = Object.freeze({
  appName: 'STI Assist AI',
  appVersion: '1.0.0',
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir: path.join(rootDir, 'data'),
  indexFile: path.join(rootDir, 'data', 'index.json'),
  // Workers read the generated index from the HANDBOOK_INDEX KV binding under
  // this key instead of the filesystem.
  indexKvKey: clean(process.env.HANDBOOK_INDEX_KEY) || 'handbook-index',
  handbookJsonFile: path.join(rootDir, 'data', 'handbook.json'),
  handbookPath: resolveFromRoot(
    clean(process.env.HANDBOOK_PATH) || 'STI High School Student Handbook 2026 (ORCA).pdf'
  ),
  handbookPdf: {
    // Source cards deep-link to this URL so students can verify a citation.
    // Serving the PDF makes the whole document downloadable; disable it if the
    // deployment does not have redistribution rights.
    //
    // On Cloudflare Workers the original PDF is deliberately never uploaded or
    // bundled, so PDF serving is always disabled there (SERVE_HANDBOOK_PDF is
    // ignored). Excerpts, citations, and printed page references still work.
    serve: isWorkerPlatform ? false : boolEnv('SERVE_HANDBOOK_PDF', true),
    publicUrl: '/handbook.pdf',
    // Printed page numbers are one less than the PDF page numbers in this
    // handbook, so printed page 39 is PDF page 40.
    pdfPageOffset: 1,
  },
  port: intEnv('PORT', 3000, { min: 1, max: 65535 }),
  isProduction: process.env.NODE_ENV === 'production',
  logLevel: clean(process.env.LOG_LEVEL) || 'info',
  ai: {
    provider,
    apiKey: apiKeyLooksReal ? apiKey : '',
    baseUrl,
    model,
    visionModel,
    timeoutMs: intEnv('AI_TIMEOUT_MS', 45000, { min: 5000, max: 120000 }),
    // Image requests are slower than text ones and some providers stall on
    // them, so this is separately tunable.
    visionTimeoutMs: intEnv('AI_VISION_TIMEOUT_MS', 30000, { min: 5000, max: 180000 }),
    // Reasoning-style VL models (e.g. Nemotron VL) can spend a lot of the
    // budget before their visible answer, so this is deliberately higher.
    visionMaxOutputTokens: intEnv('AI_VISION_MAX_OUTPUT_TOKENS', 1600, { min: 128, max: 4096 }),
    maxOutputTokens: intEnv('AI_MAX_OUTPUT_TOKENS', 900, { min: 128, max: 4096 }),
    temperature: Math.min(
      1,
      Math.max(0, Number.parseFloat(process.env.AI_TEMPERATURE || '0.1') || 0.1)
    ),
    configured: Boolean(apiKeyLooksReal && baseUrl && model),
    keyWasPlaceholder: Boolean(apiKey && !apiKeyLooksReal),
  },
  embeddings: {
    provider: embeddingProvider,
    localModel: localEmbeddingModel,
    nvidiaModel:
      clean(process.env.NVIDIA_EMBEDDING_MODEL) || 'nvidia/nemotron-3.5-embed-1b',
    apiKey: embeddingApiKey,
    baseUrl: normaliseBaseUrl(
      process.env.EMBEDDING_BASE_URL || 'https://integrate.api.nvidia.com/v1'
    ),
    timeoutMs: intEnv('EMBEDDING_TIMEOUT_MS', 30000, { min: 5000, max: 120000 }),
  },
  limits: {
    maxImageBytes: maxImageMb * 1024 * 1024,
    maxImageMb,
    maxMessageChars: intEnv('MAX_MESSAGE_CHARS', 2000, { min: 100, max: 8000 }),
    maxHistoryMessages: 8,
    maxHistoryChars: 12000,
    maxJsonBody: '48kb',
  },
  attachments: {
    ttlMs: intEnv('ATTACHMENT_TTL_MINUTES', 30, { min: 1, max: 180 }) * 60 * 1000,
    maxCount: 20,
    maxTotalBytes: 60 * 1024 * 1024,
  },
  gapLog: {
    // Anonymous log of questions that ended in the "couldn't find a clear
    // answer" fallback (used to spot handbook coverage gaps). No client
    // identifiers are stored. Set LOG_UNANSWERED_QUESTIONS=false to disable.
    enabled: boolEnv('LOG_UNANSWERED_QUESTIONS', true),
    ttlSeconds: intEnv('GAP_LOG_TTL_DAYS', 90, { min: 1, max: 365 }) * 24 * 60 * 60,
    kvPrefix: clean(process.env.GAP_LOG_KV_PREFIX) || 'gap:',
    maxQuestionChars: intEnv('GAP_LOG_MAX_QUESTION_CHARS', 500, { min: 40, max: 2000 }),
  },
  rateLimits: {
    apiWindowMs: 60 * 1000,
    apiLimit: intEnv('RATE_LIMIT_API_PER_MINUTE', 120, { min: 10, max: 1000 }),
    chatWindowMs: 60 * 1000,
    chatLimit: intEnv('RATE_LIMIT_CHAT_PER_MINUTE', 30, { min: 3, max: 200 }),
    attachmentWindowMs: 10 * 60 * 1000,
    attachmentLimit: intEnv('RATE_LIMIT_UPLOADS_PER_10_MINUTES', 12, { min: 2, max: 100 }),
  },
  trustProxy: (() => {
    const raw = clean(process.env.TRUST_PROXY).toLowerCase();
    const workerDefault = isWorkerPlatform ? 1 : false;
    if (!raw) return workerDefault;
    if (raw === 'false' || raw === '0') return false;
    if (raw === 'true') return true;
    const hops = Number.parseInt(raw, 10);
    return Number.isFinite(hops) && hops >= 0 ? hops : workerDefault;
  })(),
  isWorker: isWorkerPlatform,
  features: {
    // The demo is never presented as AI. It only quotes retrieved handbook text.
    demoMode: !(apiKeyLooksReal && baseUrl && model),
    allowDenseRetrieval: boolEnv('ENABLE_DENSE_RETRIEVAL', true),
    // Image uploads depend on an in-memory store with a cleanup timer, which is
    // not reliable on Cloudflare Workers (isolates start, stop, and run in
    // parallel). They are disabled there; the upload route answers with a clear
    // message. A future R2-backed store can re-enable them with
    // ENABLE_IMAGE_UPLOADS=true.
    imageUploads: isWorkerPlatform ? boolEnv('ENABLE_IMAGE_UPLOADS', false) : true,
  },
});

export function publicHealthConfig() {
  return {
    platform: config.isWorker ? 'cloudflare-workers' : 'node',
    provider: config.ai.provider,
    baseUrlHost: (() => {
      try {
        return new URL(config.ai.baseUrl).host;
      } catch {
        return 'invalid';
      }
    })(),
    chatModel: config.ai.model,
    visionModel: config.ai.visionModel,
    configured: config.ai.configured,
    keyWasPlaceholder: config.ai.keyWasPlaceholder,
    demoMode: config.features.demoMode,
    streaming: true,
    handbookPdf: {
      available: config.handbookPdf.serve,
      url: config.handbookPdf.serve ? config.handbookPdf.publicUrl : null,
      pdfPageOffset: config.handbookPdf.pdfPageOffset,
    },
    embeddingProvider: config.embeddings.provider,
    embeddingModel:
      config.embeddings.provider === 'local'
        ? config.embeddings.localModel
        : config.embeddings.nvidiaModel,
    imageUploads: config.features.imageUploads,
    limits: {
      maxImageMb: config.limits.maxImageMb,
      maxMessageChars: config.limits.maxMessageChars,
      attachmentTtlMinutes: Math.round(config.attachments.ttlMs / 60000),
      allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
  };
}

export function ensureDataDir() {
  // Only used by local build scripts and the local server; Workers have no
  // writable project directory.
  if (isWorkerPlatform) return;
  fs.mkdirSync(config.dataDir, { recursive: true });
}
