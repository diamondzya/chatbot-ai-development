// Anonymous "unanswered question" log.
//
// When an answer ends in the "I couldn't find a clear answer…" fallback, the
// question is recorded so an operator can spot real coverage gaps in the
// handbook index and feed them back into indexing or the plan. Privacy rules:
//   - no client identifiers are stored (no IP, client id, or history);
//   - the question is trimmed, control characters removed, and obvious emails
//     and long digit runs (phone numbers, student numbers) are redacted;
//   - entries expire: KV gets a TTL (default 90 days), and the local file is
//     plain JSONL the operator can review or delete.
//
// Storage targets:
//   - Cloudflare Worker: the HANDBOOK_INDEX KV namespace, "gap:<…>" keys.
//   - Node (local server, tests): a JSONL file (data/gaps.jsonl by default,
//     overridable with GAP_LOG_FILE).
//
// Reads: `npm run gaps` (local file) and `npm run gaps -- --remote` (KV).
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { getWorkerKv } from './runtime.js';

// Both phrasings this codebase can produce (demoAnswer / ensureHandbookFallback)
// plus the sentence the prompt asks the model to use.
const FALLBACK_PATTERNS = [
  /couldn'?t find a clear answer/i,
  /couldn'?t find a handbook passage/i,
];

export function isUnansweredAnswer(answer) {
  const text = String(answer || '');
  return FALLBACK_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizeQuestion(question, maxChars = config.gapLog.maxQuestionChars) {
  return String(question || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b\d{7,}\b/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function buildEntry({ question, mode, retrieval, sources = [] }) {
  return {
    at: new Date().toISOString(),
    mode: mode || 'unknown',
    question: sanitizeQuestion(question),
    topScore: Number(retrieval?.topScore || 0),
    // What retrieval did offer (all below the answer threshold), for triage.
    topSources: sources.slice(0, 3).map((source) => `${source.section} (p. ${source.page})`),
  };
}

/**
 * Record one unanswered question. Never throws: logging must not break a
 * student-facing answer. Returns the stored entry, or null when disabled or
 * the write failed.
 *
 * @param {object} payload
 * @param {string} payload.question
 * @param {string} [payload.mode]     - 'ai' | 'demo' | 'excerpts'
 * @param {object} [payload.retrieval]
 * @param {Array}  [payload.sources]
 * @param {object} [options]          - test seams: { kv, file }
 */
export async function recordUnansweredQuestion(payload = {}, { kv, file } = {}) {
  if (!config.gapLog.enabled) return null;
  try {
    const entry = buildEntry(payload);
    if (!entry.question) return null;

    const store = kv !== undefined ? kv : getWorkerKv();
    if (store) {
      const key = `${config.gapLog.kvPrefix}${Date.now()}-${randomUUID().slice(0, 8)}`;
      await store.put(key, JSON.stringify(entry), {
        expirationTtl: config.gapLog.ttlSeconds,
      });
      return entry;
    }

    const targetFile =
      file || process.env.GAP_LOG_FILE || path.join(config.dataDir, 'gaps.jsonl');
    const { appendFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(targetFile), { recursive: true });
    await appendFile(targetFile, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  } catch (error) {
    console.warn(`gap log write failed: ${error?.message || error}`);
    return null;
  }
}
