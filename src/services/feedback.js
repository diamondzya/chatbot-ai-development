/* ==========================================================================
   Anonymous answer feedback
   Stores verdict counters and per-section tallies in memory only. No free
   text, no client identifiers, and nothing is written to disk.
   ========================================================================== */

import { HttpError } from '../errors.js';

const VERDICTS = new Set(['helpful', 'not_helpful']);
const MAX_SECTIONS = 200;

const state = {
  helpful: 0,
  not_helpful: 0,
  bySection: new Map(),
  lastAt: null,
};

export function validateFeedback(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_feedback', 'Send a JSON object with a "verdict" field.');
  }
  const verdict = typeof body.verdict === 'string' ? body.verdict.trim() : '';
  if (!VERDICTS.has(verdict)) {
    throw new HttpError(400, 'invalid_feedback', 'The verdict must be "helpful" or "not_helpful".');
  }

  let section = '';
  if (body.section !== undefined && body.section !== null) {
    if (typeof body.section !== 'string' || body.section.length > 120) {
      throw new HttpError(400, 'invalid_feedback', 'The section reference is not valid.');
    }
    section = body.section.trim().slice(0, 120);
  }

  let page = null;
  if (body.page !== undefined && body.page !== null) {
    const value = Number(body.page);
    if (!Number.isInteger(value) || value < 0 || value > 2000) {
      throw new HttpError(400, 'invalid_feedback', 'The page reference is not valid.');
    }
    page = value;
  }

  let mode = '';
  if (body.mode !== undefined && body.mode !== null) {
    if (typeof body.mode !== 'string' || !['ai', 'demo', 'excerpts', 'guide'].includes(body.mode)) {
      throw new HttpError(400, 'invalid_feedback', 'The answer mode is not valid.');
    }
    mode = body.mode;
  }

  return { verdict, section, page, mode };
}

export function recordFeedback({ verdict, section = '', page = null, mode = '' }) {
  state[verdict] += 1;
  state.lastAt = new Date().toISOString();

  if (section) {
    const key = page === null ? section : `${section}|p.${page}`;
    const current = state.bySection.get(key) || { section, page, helpful: 0, not_helpful: 0 };
    current[verdict] += 1;
    // Bound the map so a long-running server cannot grow it without limit.
    if (!state.bySection.has(key) && state.bySection.size >= MAX_SECTIONS) {
      const oldest = state.bySection.keys().next().value;
      state.bySection.delete(oldest);
    }
    state.bySection.set(key, current);
  }

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'answer feedback',
      verdict,
      section: section || undefined,
      page: page ?? undefined,
      mode: mode || undefined,
    })
  );

  return getFeedbackStats();
}

export function getFeedbackStats() {
  const total = state.helpful + state.not_helpful;
  return {
    total,
    helpful: state.helpful,
    not_helpful: state.not_helpful,
    helpfulRate: total > 0 ? Number((state.helpful / total).toFixed(3)) : null,
    lastAt: state.lastAt,
  };
}

export function resetFeedback() {
  state.helpful = 0;
  state.not_helpful = 0;
  state.bySection.clear();
  state.lastAt = null;
}
