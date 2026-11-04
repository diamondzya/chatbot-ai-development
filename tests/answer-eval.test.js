import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_GOLDEN,
  rowFailures,
  runAnswerEval,
  scoreAnswer,
} from '../scripts/eval-answers.js';

// Synthetic responses only: the scorer is exercised without the confidential
// handbook index, so this file runs in the handbook-free CI subset.

function source({ page = 12, section = 'Synthetic Section' } = {}) {
  return {
    id: `synthetic-${page}`,
    section,
    chapter: 'Synthetic Chapter',
    page,
    pageEnd: page,
    excerpt: 'Synthetic handbook excerpt for scoring tests.',
    source: 'Synthetic Handbook',
  };
}

function aiAnswer({ page = 12, section = 'Synthetic Section', cite = true, extra = '' } = {}) {
  const citation = cite ? ` See p. ${page}.` : '';
  return {
    mode: 'ai',
    aiGenerated: true,
    answer: `Synthetic grounded answer about the policy.${citation} ${extra}`.trim(),
    sources: [source({ page, section })],
    safety: { category: 'school' },
    meta: { topScore: 0.9 },
  };
}

test('scoreAnswer accepts a grounded answer that cites a retrieved page', () => {
  const checks = scoreAnswer({ kind: 'covered', section: /Synthetic/, page: 12 }, aiAnswer());

  assert.equal(checks.sane, true);
  assert.equal(checks.sectionHit, true);
  assert.equal(checks.pageHit, true);
  assert.equal(checks.fallbackOk, true);
  assert.deepEqual(checks.citations, { present: true, grounded: true, invalid: [] });
  assert.deepEqual(
    rowFailures({ ...checks, kind: 'covered', mode: 'ai', aiGenerated: true, expectCategory: undefined }),
    []
  );
});

test('scoreAnswer catches fabricated and missing citations', () => {
  const fabricated = aiAnswer();
  fabricated.answer += ' The rule is also on p. 999.';
  const fabricatedChecks = scoreAnswer(
    { kind: 'covered', section: /Synthetic/, page: 12 },
    fabricated
  );
  assert.equal(fabricatedChecks.citations.present, true);
  assert.equal(fabricatedChecks.citations.grounded, false);
  assert.ok(fabricatedChecks.citations.invalid.includes('999'));

  const missing = scoreAnswer({ kind: 'covered' }, aiAnswer({ cite: false }));
  assert.equal(missing.citations.present, false);
  assert.equal(missing.citations.grounded, null);
});

test('scoreAnswer judges fallback honesty for uncovered and covered questions', () => {
  const fallback = {
    mode: 'ai',
    aiGenerated: true,
    answer:
      "I couldn't find a clear answer to this in the available student handbook. Please confirm with the appropriate school office before relying on it.",
    sources: [],
    safety: { category: 'school' },
  };

  assert.equal(scoreAnswer({ kind: 'uncovered' }, fallback).fallbackOk, true);
  assert.equal(scoreAnswer({ kind: 'covered' }, fallback).fallbackOk, false);
});

test('scoreAnswer checks refusal categories', () => {
  const refusal = {
    mode: 'guide',
    aiGenerated: false,
    answer:
      'This asks for something I cannot help with. If there is a real safety concern, talk to a trusted adult or school official right away.',
    sources: [],
    safety: { category: 'academic_dishonesty' },
  };

  assert.equal(
    scoreAnswer({ kind: 'refusal', expectCategory: 'academic_dishonesty' }, refusal).refusalOk,
    true
  );
  assert.equal(
    scoreAnswer({ kind: 'refusal', expectCategory: 'violence' }, refusal).refusalOk,
    false
  );
  assert.equal(scoreAnswer({ kind: 'covered' }, refusal).refusalOk, null);
});

test('scoreAnswer treats provider error text and tiny answers as not sane', () => {
  const timedOut = {
    mode: 'ai',
    aiGenerated: true,
    answer: 'The AI provider did not respond in time. Please try again in a moment.',
    sources: [],
  };
  assert.equal(scoreAnswer({ kind: 'covered' }, timedOut).sane, false);
  assert.equal(scoreAnswer({ kind: 'covered' }, { answer: 'too short' }).sane, false);
});

test('runAnswerEval scores an injected chat function and passes good answers', async () => {
  const questions = [
    { query: 'covered question', kind: 'covered', section: /Synthetic/, page: 12 },
    { query: 'uncovered question', kind: 'uncovered' },
    { query: 'refusal question', kind: 'refusal', expectCategory: 'violence' },
  ];

  const goodChat = async ({ message }) => {
    if (message === 'covered question') return aiAnswer();
    if (message === 'uncovered question') {
      return {
        mode: 'ai',
        aiGenerated: true,
        answer:
          "I couldn't find a clear answer to this in the available student handbook. Please confirm with the appropriate school office.",
        sources: [],
        safety: { category: 'school' },
        meta: { topScore: 0.1 },
      };
    }
    return {
      mode: 'guide',
      aiGenerated: false,
      answer:
        'This asks for something I cannot help with. If you are in danger, contact a trusted adult or emergency services right away.',
      sources: [],
      safety: { category: 'violence' },
    };
  };

  const report = await runAnswerEval({ chat: goodChat, questions });

  assert.equal(report.total, 3);
  assert.equal(report.aiWritten, 2);
  assert.equal(report.passed, true);
  assert.equal(report.metrics.sane.rate, 1);
  assert.equal(report.metrics.section.rate, 1);
  assert.equal(report.metrics.fallback.rate, 1);
  assert.equal(report.metrics.refusal.rate, 1);
  assert.equal(report.metrics.citationPresent.rate, 1);
  assert.equal(report.metrics.citationGrounded.rate, 1);
});

test('runAnswerEval fails when an answer fabricates a citation', async () => {
  const badChat = async () => {
    const response = aiAnswer();
    response.answer += ' The rule is also on p. 77.';
    return response;
  };

  const report = await runAnswerEval({
    chat: badChat,
    questions: [{ query: 'covered question', kind: 'covered', section: /Synthetic/, page: 12 }],
  });

  assert.equal(report.passed, false);
  assert.equal(report.metrics.citationGrounded.rate, 0);
  assert.ok(rowFailures(report.rows[0]).some((failure) => /cited page/i.test(failure)));
});

test('runAnswerEval reports a failed request clearly instead of throwing', async () => {
  const report = await runAnswerEval({
    chat: async () => {
      throw new Error('index unavailable');
    },
    questions: [{ query: 'covered question', kind: 'covered' }],
  });

  assert.equal(report.passed, false);
  assert.equal(report.rows[0].mode, 'error');
  assert.match(rowFailures(report.rows[0]).join(' '), /request failed: index unavailable/);
});

test('the golden answer set covers retrieval, fallbacks, and refusals', () => {
  const kinds = new Set(ANSWER_GOLDEN.map((entry) => entry.kind));
  assert.ok(kinds.has('covered'));
  assert.ok(kinds.has('uncovered'));
  assert.ok(kinds.has('refusal'));
  assert.ok(ANSWER_GOLDEN.length >= 25, `expected a broad golden set, got ${ANSWER_GOLDEN.length}`);
  for (const entry of ANSWER_GOLDEN.filter((item) => item.kind === 'refusal')) {
    assert.ok(entry.expectCategory, `refusal entry "${entry.query}" needs an expected category`);
  }
});
