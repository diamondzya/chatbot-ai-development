// Worker-mode tests: the same Express app, but running with the Cloudflare
// Workers configuration (index from KV, image uploads off, no PDF, no static
// file serving, no local embedding models).
//
// A small synthetic index is used instead of the real data/index.json so the
// tests run without the handbook PDF, the built index, or network access.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

// These must be set before src/config is imported for the first time. Each
// test file runs in its own process, so this does not affect the Node-mode
// tests.
process.env.WORKER_PLATFORM = '1';
process.env.ENABLE_DENSE_RETRIEVAL = 'false';
process.env.AI_API_KEY = '';
process.env.EMBEDDING_API_KEY = '';
process.env.NODE_ENV = 'test';
// Must be ignored on Workers: the PDF is never uploaded there.
process.env.SERVE_HANDBOOK_PDF = 'true';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

const { config } = await import('../src/config/index.js');
const { createApp } = await import('../src/app.js');
const { resetIndexCache } = await import('../src/services/handbookSearch.js');
const { setWorkerRuntime, resetWorkerRuntime } = await import('../src/services/runtime.js');

function syntheticIndex() {
  const chunks = [
    {
      id: 'chunk-id',
      section: 'School Identification (ID) Card',
      chapter: 'Student Behavior & Discipline',
      page: 39,
      pageEnd: 39,
      keywords: 'id card forget lost replacement temporary',
      text: 'Students who forget their school ID must report to the Assistant Principal before class hours to get a temporary ID, which is good for one day only.',
      source: 'Synthetic Handbook',
    },
    {
      id: 'chunk-late',
      section: 'Tardiness',
      chapter: 'Attendance',
      page: 37,
      pageEnd: 37,
      keywords: 'late tardiness attendance punctuality',
      text: 'Students who are late to class must secure a late slip from the discipline office before entering the classroom.',
      source: 'Synthetic Handbook',
    },
    {
      id: 'chunk-uniform',
      section: 'School Uniform',
      chapter: 'Student Conduct',
      page: 40,
      pageEnd: 40,
      keywords: 'uniform slippers shoes attire wear',
      text: 'Students must wear the prescribed school uniform at all times. Slippers are not allowed on campus.',
      source: 'Synthetic Handbook',
    },
  ];
  return JSON.stringify({
    meta: {
      title: 'Synthetic Handbook',
      edition: 'Test',
      published: '2026',
      chunks: chunks.length,
      sections: chunks.length,
      generatedAt: '2026-11-01T00:00:00.000Z',
      indexedPrintedPages: { from: 37, to: 40 },
    },
    embedding: { provider: 'local', model: 'synthetic-test-model' },
    // One tiny vector per chunk; with a local-built index the Worker skips
    // dense retrieval, so the values are irrelevant.
    vectors: chunks.map(() => [0, 0, 0, 0]),
    chunks,
  });
}

function createFakeKv(raw) {
  const kv = {
    reads: 0,
    value: raw,
    async get(key) {
      kv.reads += 1;
      if (key !== 'handbook-index') return null;
      return kv.value;
    },
  };
  return kv;
}

describe('Cloudflare Worker mode', () => {
  it('identifies the platform and disables local-only features', () => {
    assert.equal(config.isWorker, true);
    // Image uploads default to off on Workers even though Node keeps them on.
    assert.equal(config.features.imageUploads, false);
    // SERVE_HANDBOOK_PDF=true must be ignored on Workers.
    assert.equal(config.handbookPdf.serve, false);
  });

  it('loads the handbook index from KV and caches it in the isolate', async () => {
    const kv = createFakeKv(syntheticIndex());
    resetIndexCache();
    resetWorkerRuntime();
    setWorkerRuntime({ kv });

    const app = createApp();
    const health = await request(app).get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.index.ready, true);
    assert.equal(health.body.index.chunks, 3);
    assert.equal(health.body.index.stale, null);
    assert.equal(health.body.index.handbookModifiedAt, null);
    assert.equal(health.body.mode, 'demo');
    assert.equal(kv.reads, 1);

    // A second request must reuse the isolate cache, not re-read KV.
    await request(app).get('/api/handbook/sections');
    await request(app).get('/api/meta');
    assert.equal(kv.reads, 1);
  });

  it('answers a handbook question from the KV index and cites the source', async () => {
    const kv = createFakeKv(syntheticIndex());
    resetIndexCache();
    resetWorkerRuntime();
    setWorkerRuntime({ kv });

    const app = createApp();
    const response = await request(app)
      .post('/api/chat')
      .send({ message: 'What should I do if I forget my school ID?' });

    assert.equal(response.status, 200);
    assert.equal(response.body.mode, 'demo');
    assert.equal(response.body.aiGenerated, false);
    assert.equal(response.body.sources[0].section, 'School Identification (ID) Card');
    assert.equal(response.body.sources[0].page, 39);
  });

  it('keeps Taglish retrieval working with the KV index', async () => {
    const kv = createFakeKv(syntheticIndex());
    resetIndexCache();
    resetWorkerRuntime();
    setWorkerRuntime({ kv });

    const app = createApp();
    const response = await request(app)
      .post('/api/chat')
      .send({ message: 'Nakalimutan ko ID ko, makakapasok pa ba ako?' });

    assert.equal(response.status, 200);
    assert.equal(response.body.sources[0].section, 'School Identification (ID) Card');
  });

  it('reports capabilities, hides the PDF, and rejects image uploads with a clear message', async () => {
    const kv = createFakeKv(syntheticIndex());
    resetIndexCache();
    resetWorkerRuntime();
    setWorkerRuntime({ kv });

    const app = createApp();

    const meta = await request(app).get('/api/meta');
    assert.equal(meta.status, 200);
    assert.equal(meta.body.capabilities.platform, 'cloudflare-workers');
    assert.equal(meta.body.capabilities.imageUploads, false);
    assert.equal(meta.body.capabilities.handbookPdf, false);
    assert.ok(meta.body.capabilities.imageUploadsMessage);
    // Citations still work; there is simply no PDF to deep-link into.
    assert.equal(meta.body.handbook.openUrl, null);
    assert.equal(meta.body.provider.handbookPdf.available, false);

    const upload = await request(app).post('/api/attachments');
    assert.equal(upload.status, 501);
    assert.equal(upload.body.error.code, 'image_uploads_unavailable');
    assert.match(upload.body.error.message, /not available on this deployment/i);

    const pdf = await request(app).get('/handbook.pdf');
    assert.equal(pdf.status, 404);
  });

  it('streams a demo answer over SSE', async () => {
    const kv = createFakeKv(syntheticIndex());
    resetIndexCache();
    resetWorkerRuntime();
    setWorkerRuntime({ kv });

    const app = createApp();
    const response = await request(app)
      .post('/api/chat/stream')
      .send({ message: 'What should I do if I forget my school ID?' });

    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/event-stream/);
    assert.match(response.text, /event: done/);
    assert.match(response.text, /School Identification \(ID\) Card/);
  });

  it('applies the safety filter before retrieval in Worker mode', async () => {
    const kv = createFakeKv(syntheticIndex());
    resetIndexCache();
    resetWorkerRuntime();
    setWorkerRuntime({ kv });

    const app = createApp();
    const response = await request(app)
      .post('/api/chat')
      .send({ message: 'How can I hide a weapon in my bag?' });

    assert.equal(response.status, 200);
    assert.equal(response.body.mode, 'guide');
    assert.equal(response.body.aiGenerated, false);
  });

  it('fails with an actionable message when the KV index is missing', async () => {
    const kv = createFakeKv(null);
    resetIndexCache();
    resetWorkerRuntime();
    setWorkerRuntime({ kv });

    const app = createApp();
    const health = await request(app).get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.index.ready, false);

    const meta = await request(app).get('/api/meta');
    assert.equal(meta.status, 200);
    assert.equal(meta.body.handbook, null);

    // restore for whatever runs next
    resetIndexCache();
    resetWorkerRuntime();
  });

  it('has no SPA fallback or static file serving of its own on Workers', async () => {
    const kv = createFakeKv(syntheticIndex());
    resetIndexCache();
    resetWorkerRuntime();
    setWorkerRuntime({ kv });

    const app = createApp();
    const page = await request(app).get('/some/deep/link').set('Accept', 'text/html');
    assert.equal(page.status, 404);
    assert.equal(page.body.error.code, 'not_found');

    const headers = await request(app).get('/api/health');
    assert.equal(headers.headers['x-content-type-options'], 'nosniff');
    assert.ok(headers.headers['content-security-policy']);
  });

  it('ships a Worker entry without Node server lifecycle handlers', () => {
    const source = fs.readFileSync(path.join(rootDir, 'worker', 'index.js'), 'utf8');
    assert.match(source, /httpServerHandler/);
    assert.match(source, /cloudflare:node/);
    // No Node server lifecycle code in the Worker entry point.
    assert.doesNotMatch(source, /process\.on\(|process\.exit\(|server\.close\(/);
  });

  it('wires static assets, KV, and worker-first API routing in wrangler.jsonc', () => {
    const raw = fs.readFileSync(path.join(rootDir, 'wrangler.jsonc'), 'utf8');
    assert.match(raw, /"main":\s*"worker\/index\.js"/);
    assert.match(raw, /"directory":\s*"\.\/public"/);
    assert.match(raw, /"binding":\s*"ASSETS"/);
    assert.match(raw, /"run_worker_first":\s*\[\s*"\/api\/\*"\s*\]/);
    assert.match(raw, /"binding":\s*"HANDBOOK_INDEX"/);
    assert.match(raw, /"compatibility_date":\s*"\d{4}-\d{2}-\d{2}"/);
    // The handbook index must never become a public static file.
    assert.doesNotMatch(raw, /"directory":\s*"\.\/data"/);
  });
});
