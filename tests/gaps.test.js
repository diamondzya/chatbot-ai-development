import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Force demo mode before any module reads the environment (see tests/api.test.js).
process.env.NODE_ENV = 'test';
process.env.AI_API_KEY = '';
process.env.ENABLE_DENSE_RETRIEVAL = 'false';
process.env.LOG_UNANSWERED_QUESTIONS = 'true';

const gapDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sti-gaps-'));
process.env.GAP_LOG_FILE = path.join(gapDir, 'integration.jsonl');

const { isUnansweredAnswer, sanitizeQuestion, recordUnansweredQuestion } = await import(
  '../src/services/gapLog.js'
);
const { handleChat } = await import('../src/services/chatService.js');

after(async () => {
  await fs.rm(gapDir, { recursive: true, force: true });
});

test('detects the fallback phrasings and ignores normal answers', () => {
  assert.equal(
    isUnansweredAnswer(
      "I couldn't find a clear answer to this in the available student handbook. Please confirm with the appropriate school office before relying on it."
    ),
    true
  );
  assert.equal(
    isUnansweredAnswer(
      'Some text\n\n> I couldn\'t find a handbook passage that clearly answers this. Please confirm with the appropriate school office before relying on it.'
    ),
    true
  );
  assert.equal(isUnansweredAnswer('Wear the proper uniform at all times (p. 40).'), false);
  assert.equal(isUnansweredAnswer(''), false);
});

test('sanitizes questions: control characters, emails, numbers, length', () => {
  const sanitized = sanitizeQuestion(
    'Can you email me at juan.delacruz@example.com or call 09171234567\u0000 about my ID?'
  );
  assert.ok(!sanitized.includes('juan.delacruz@example.com'));
  assert.ok(!sanitized.includes('09171234567'));
  assert.ok(sanitized.includes('[email]'));
  assert.ok(sanitized.includes('[number]'));
  assert.ok(!sanitized.includes('\u0000'));

  assert.equal(sanitizeQuestion('x'.repeat(900)).length, 500);
});

test('writes KV entries with the gap prefix and a TTL', async () => {
  const puts = [];
  const fakeKv = {
    async put(key, value, options) {
      puts.push({ key, value, options });
    },
  };
  const entry = await recordUnansweredQuestion(
    {
      question: 'What are the canteen prices?',
      mode: 'ai',
      retrieval: { topScore: 0.05 },
      sources: [{ section: 'Fees and Payments', page: 22 }],
    },
    { kv: fakeKv }
  );

  assert.equal(puts.length, 1);
  assert.ok(puts[0].key.startsWith('gap:'));
  assert.ok(puts[0].options.expirationTtl >= 24 * 60 * 60);
  const stored = JSON.parse(puts[0].value);
  assert.equal(stored.question, 'What are the canteen prices?');
  assert.equal(stored.mode, 'ai');
  assert.equal(stored.topScore, 0.05);
  assert.deepEqual(stored.topSources, ['Fees and Payments (p. 22)']);
  assert.equal(entry.question, 'What are the canteen prices?');
});

test('appends JSONL entries to the local file without client identifiers', async () => {
  const file = path.join(gapDir, 'direct.jsonl');
  await recordUnansweredQuestion(
    { question: 'Ano ang presyo sa canteen?', mode: 'demo', retrieval: { topScore: 0 } },
    { file }
  );
  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.question, 'Ano ang presyo sa canteen?');
  assert.equal(entry.mode, 'demo');
  assert.ok(entry.at);
  assert.deepEqual(Object.keys(entry).sort(), [
    'at',
    'mode',
    'question',
    'topScore',
    'topSources',
  ]);
});

test('a demo fallback answer records the question through handleChat', async () => {
  // With a BM25-only index this question matches nothing above the source
  // threshold, so the demo answer falls back to "I couldn't find a clear
  // answer" and the question is logged.
  const result = await handleChat({ message: 'What are the canteen prices?' });
  assert.equal(result.mode, 'demo');
  assert.ok(isUnansweredAnswer(result.answer));

  const lines = (await fs.readFile(process.env.GAP_LOG_FILE, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1, 'exactly one gap entry expected');
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.question, 'What are the canteen prices?');
  assert.equal(entry.mode, 'demo');
});
