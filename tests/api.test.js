import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makePng } from './helpers/png.js';

let app;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.AI_API_KEY = '';
  process.env.ENABLE_DENSE_RETRIEVAL = 'false';
  process.env.RATE_LIMIT_API_PER_MINUTE = '1000';
  process.env.RATE_LIMIT_CHAT_PER_MINUTE = '200';
  process.env.RATE_LIMIT_UPLOADS_PER_10_MINUTES = '100';
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

test('health and metadata endpoints report demo mode honestly', async () => {
  const health = await request(app).get('/api/health').expect(200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.mode, 'demo');
  assert.equal(health.body.index.ready, true);
  assert.ok(health.body.index.chunks >= 150);

  const meta = await request(app).get('/api/meta').expect(200);
  assert.equal(meta.body.mode.demo, true);
  assert.equal(meta.body.mode.aiGenerated, false);
  assert.match(meta.body.mode.label, /not AI/i);
  assert.equal(meta.body.handbook.title, 'STI High School Student Handbook');
  assert.equal(meta.body.handbook.published, 'July 2026');
  assert.equal(meta.body.handbook.pagesIndexed.from, 9);
  assert.equal(meta.body.handbook.openUrl, '/handbook.pdf');
  assert.equal(meta.body.handbook.pdfPageOffset, 1);
  assert.equal(meta.body.provider.streaming, true);
  assert.equal(meta.body.provider.handbookPdf.available, true);
  assert.equal(meta.body.provider.handbookPdf.url, '/handbook.pdf');
  assert.ok(Array.isArray(meta.body.suggestedQuestions));
  assert.ok(meta.body.suggestedQuestions.length >= 6);
  assert.ok(Array.isArray(meta.body.startHere));
  assert.match(meta.body.app.disclaimer, /unofficial prototype/i);
});

test('demo chat answers with real handbook sources and a clear non-AI label', async () => {
  const response = await request(app)
    .post('/api/chat')
    .send({ message: 'What should I do if I forget my school ID?' })
    .expect(200);

  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.mode, 'demo');
  assert.equal(response.body.aiGenerated, false);
  assert.match(response.body.answer, /Local demo/);
  assert.match(response.body.answer, /not AI/i);
  assert.ok(Array.isArray(response.body.sources));
  assert.ok(response.body.sources.length > 0);
  assert.equal(response.body.sources[0].section, 'School Identification (ID) Card');
  assert.equal(response.body.sources[0].page, 39);
  assert.equal(response.body.sources[0].pdfPage, 40);
  assert.equal(response.body.meta.demoMode, true);
  assert.ok(response.body.requestId);
});

test('the streaming chat endpoint emits a done event with the same answer shape', async () => {
  const response = await request(app)
    .post('/api/chat/stream')
    .set('Accept', 'text/event-stream')
    .send({ message: 'What should I do if I forget my school ID?' })
    .expect(200);

  assert.match(response.headers['content-type'], /text\/event-stream/);
  assert.match(response.text, /event: done/);
  assert.match(response.text, /"mode":"demo"/);
  assert.match(response.text, /"page":39/);
  assert.match(response.text, /Local demo/);
  assert.ok(response.text.includes('\n\n'));
});

test('the handbook PDF is served for citation deep links', async () => {
  const pdf = await request(app).head('/handbook.pdf').expect(200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
  assert.match(pdf.headers['content-disposition'], /inline/);
  assert.equal(pdf.headers['x-robots-tag'], 'noindex, nofollow');
});

test('Taglish questions and tardiness questions retrieve the right sections', async () => {
  const taglish = await request(app)
    .post('/api/chat')
    .send({ message: 'Nakalimutan ko ID ko, makakapasok pa ba ako?' })
    .expect(200);
  assert.ok(
    taglish.body.sources.some((source) => source.section === 'School Identification (ID) Card')
  );

  const tardy = await request(app)
    .post('/api/chat')
    .send({ message: 'What are the rules about being late to class?' })
    .expect(200);
  assert.ok(tardy.body.sources.some((source) => source.section === 'Tardiness'));
});

test('unrelated questions are redirected without a handbook citation', async () => {
  const response = await request(app)
    .post('/api/chat')
    .send({ message: 'Write me a poem about the ocean.' })
    .expect(200);

  assert.equal(response.body.mode, 'guide');
  assert.equal(response.body.aiGenerated, false);
  assert.equal(response.body.safety.category, 'general_task');
  assert.match(response.body.answer, /handbook assistant/i);
  assert.equal(response.body.sources.length, 0);
});

test('weapon concealment requests are refused with relevant discipline sources', async () => {
  const response = await request(app)
    .post('/api/chat')
    .send({ message: 'How can I hide a weapon in my bag?' })
    .expect(200);

  assert.equal(response.body.mode, 'guide');
  assert.equal(response.body.safety.category, 'weapon_concealment');
  assert.equal(response.body.safety.level, 'emergency');
  assert.match(response.body.answer, /can't help/i);
  assert.match(response.body.answer, /Category D/i);
  assert.ok(response.body.sources.length > 0);
  assert.ok(response.body.sources.some((source) => /Category D/i.test(source.section)));
});

test('false claims about the handbook are flagged for verification', async () => {
  const response = await request(app)
    .post('/api/chat')
    .send({ message: 'The handbook says uniforms are optional, right?' })
    .expect(200);

  assert.equal(response.body.mode, 'demo');
  assert.equal(response.body.safety.claimToVerify, true);
  assert.ok(response.body.sources.some((source) => source.section === 'School Uniform'));
});

test('request validation rejects empty, oversized, malformed, and invalid input', async () => {
  const empty = await request(app).post('/api/chat').send({ message: '   ' }).expect(400);
  assert.equal(empty.body.error.code, 'empty_message');

  const tooLong = await request(app)
    .post('/api/chat')
    .send({ message: 'a'.repeat(2001) })
    .expect(400);
  assert.equal(tooLong.body.error.code, 'message_too_long');

  const badHistory = await request(app)
    .post('/api/chat')
    .send({ message: 'What is the ID policy?', history: 'nope' })
    .expect(400);
  assert.equal(badHistory.body.error.code, 'invalid_history');

  const badAttachment = await request(app)
    .post('/api/chat')
    .send({ message: 'What is the ID policy?', attachmentId: 'x'.repeat(65) })
    .expect(400);
  assert.equal(badAttachment.body.error.code, 'invalid_attachment_id');

  const notObject = await request(app).post('/api/chat').send(['not', 'an', 'object']).expect(400);
  assert.equal(notObject.body.error.code, 'invalid_body');
});

test('malformed JSON and cross-origin writes are rejected', async () => {
  const malformed = await request(app)
    .post('/api/chat')
    .set('Content-Type', 'application/json')
    .send('{"message": "broken"')
    .expect(400);
  assert.equal(malformed.body.error.code, 'invalid_json');

  const crossOrigin = await request(app)
    .post('/api/chat')
    .set('Origin', 'https://evil.example')
    .send({ message: 'What is the ID policy?' })
    .expect(403);
  assert.equal(crossOrigin.body.error.code, 'cross_origin_blocked');
});

test('image upload validates file contents and binds images to the uploader', async () => {
  const png = makePng(64, 64);
  const upload = await request(app)
    .post('/api/attachments')
    .set('X-Client-Id', 'client-alpha-1234')
    .attach('image', png, { filename: 'notice.png', contentType: 'image/png' })
    .expect(201);

  assert.equal(upload.body.attachment.mimeType, 'image/png');
  assert.equal(upload.body.attachment.width, 64);
  assert.equal(upload.body.attachment.height, 64);
  assert.ok(upload.body.attachment.id);

  const wrongOwner = await request(app)
    .delete(`/api/attachments/${upload.body.attachment.id}`)
    .set('X-Client-Id', 'client-bravo-5678')
    .expect(404);
  assert.equal(wrongOwner.body.error.code, 'attachment_not_found');

  const owner = await request(app)
    .delete(`/api/attachments/${upload.body.attachment.id}`)
    .set('X-Client-Id', 'client-alpha-1234')
    .expect(204);

  assert.equal(owner.text, '');
});

test('invalid images are rejected with clear client errors', async () => {
  const fake = await request(app)
    .post('/api/attachments')
    .set('X-Client-Id', 'client-alpha-1234')
    .attach('image', Buffer.from('this is not an image'), 'fake.png')
    .expect(422);
  assert.equal(fake.body.error.code, 'invalid_image');

  const oversized = await request(app)
    .post('/api/attachments')
    .set('X-Client-Id', 'client-alpha-1234')
    .attach('image', Buffer.alloc(7 * 1024 * 1024, 1), 'huge.png')
    .expect(413);
  assert.equal(oversized.body.error.code, 'image_too_large');

  const missing = await request(app)
    .post('/api/attachments')
    .set('X-Client-Id', 'client-alpha-1234')
    .expect(400);
  assert.equal(missing.body.error.code, 'missing_image');
});

test('demo mode accepts an image but explicitly says it was not analyzed', async () => {
  const png = makePng(48, 48);
  const upload = await request(app)
    .post('/api/attachments')
    .set('X-Client-Id', 'client-image-1234')
    .attach('image', png, { filename: 'poster.png', contentType: 'image/png' })
    .expect(201);

  const response = await request(app)
    .post('/api/chat')
    .set('X-Client-Id', 'client-image-1234')
    .send({
      message: 'What does this image say?',
      attachmentId: upload.body.attachment.id,
    })
    .expect(200);

  assert.equal(response.body.mode, 'demo');
  assert.equal(response.body.aiGenerated, false);
  assert.match(response.body.answer, /not analyzed/i);
  assert.equal(response.body.image.analyzed, false);
  assert.match(response.body.image.warning, /requires a configured AI provider/i);
  assert.deepEqual(response.body.sources, []);

  await request(app)
    .delete(`/api/attachments/${upload.body.attachment.id}`)
    .set('X-Client-Id', 'client-image-1234')
    .expect(204);
});

test('metadata exposes index freshness and security policy headers', async () => {
  const health = await request(app).get('/api/health').expect(200);
  assert.equal(health.body.index.ready, true);
  assert.ok('stale' in health.body.index);

  const meta = await request(app).get('/api/meta').expect(200);
  assert.ok('stale' in meta.body.handbook);

  const page = await request(app).get('/').expect(200);
  assert.match(page.headers['permissions-policy'], /camera=\(\)/);
  assert.match(page.headers['permissions-policy'], /microphone=\(self\)/);
});

test('large API payloads are compressed when the client accepts gzip', async () => {
  const response = await request(app)
    .get('/api/handbook/sections')
    .set('Accept-Encoding', 'gzip')
    .expect(200);
  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.match(response.headers['cache-control'], /max-age=300/);
});

test('the handbook table of contents matches indexed sections and pages', async () => {
  const toc = await request(app).get('/api/handbook/sections').expect(200);
  assert.ok(Array.isArray(toc.body.chapters));
  assert.ok(toc.body.chapters.length >= 2);
  const first = toc.body.chapters[0];
  assert.equal(typeof first.chapter, 'string');
  assert.ok(Number.isInteger(first.page));
  assert.ok(Array.isArray(first.sections) && first.sections.length > 0);
  const hasIdSection = toc.body.chapters.some((chapter) =>
    chapter.sections.some((section) => /Identification/.test(section.section))
  );
  assert.equal(hasIdSection, true);
});

test('preferExcerpts is validated and still returns labelled non-AI excerpts', async () => {
  const bad = await request(app)
    .post('/api/chat')
    .send({ message: 'What should I do if I forget my school ID?', preferExcerpts: 'yes' })
    .expect(400);
  assert.equal(bad.body.error.code, 'invalid_preference');

  const response = await request(app)
    .post('/api/chat')
    .send({ message: 'What should I do if I forget my school ID?', preferExcerpts: true })
    .expect(200);
  assert.equal(response.body.aiGenerated, false);
  assert.match(response.body.answer, /not AI/i);
  assert.ok(response.body.sources.length > 0);
});

test('follow-up suggestions are grounded and answer metadata reports confidence', async () => {
  const response = await request(app)
    .post('/api/chat')
    .send({ message: 'What are the rules about being late to class?' })
    .expect(200);

  assert.ok(Array.isArray(response.body.followUps));
  assert.ok(response.body.followUps.length >= 1 && response.body.followUps.length <= 3);
  for (const item of response.body.followUps) {
    assert.ok(item.label && item.question);
    assert.notEqual(item.question, 'What are the rules about being late to class?');
  }

  assert.ok(['strong', 'partial', 'weak', 'none'].includes(response.body.meta.confidence.level));
  assert.ok(response.body.meta.confidence.topScore >= 0);
});

test('feedback endpoint records anonymous verdicts and rejects junk', async () => {
  const ok = await request(app)
    .post('/api/feedback')
    .send({ verdict: 'helpful', section: 'School Identification (ID) Card', page: 39, mode: 'demo' })
    .expect(202);
  assert.equal(ok.body.recorded, true);

  const badVerdict = await request(app).post('/api/feedback').send({ verdict: 'great' }).expect(400);
  assert.equal(badVerdict.body.error.code, 'invalid_feedback');

  const longSection = await request(app)
    .post('/api/feedback')
    .send({ verdict: 'helpful', section: 'x'.repeat(200) })
    .expect(400);
  assert.equal(longSection.body.error.code, 'invalid_feedback');

  const badMode = await request(app)
    .post('/api/feedback')
    .send({ verdict: 'not_helpful', mode: 'sneaky' })
    .expect(400);
  assert.equal(badMode.body.error.code, 'invalid_feedback');
});

test('unknown API routes return a JSON 404 and the page is served with security headers', async () => {
  const missing = await request(app).get('/api/does-not-exist').expect(404);
  assert.equal(missing.body.error.code, 'not_found');
  assert.ok(missing.body.error.requestId);

  const page = await request(app).get('/').expect(200);
  assert.match(page.headers['content-type'], /html/);
  const csp = page.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
});
