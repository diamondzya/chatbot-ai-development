import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

let app;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.AI_API_KEY = '';
  process.env.ENABLE_DENSE_RETRIEVAL = 'false';
  process.env.RATE_LIMIT_API_PER_MINUTE = '1000';
  process.env.RATE_LIMIT_CHAT_PER_MINUTE = '3';
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

test('chat requests are rate limited per connection', async () => {
  for (let i = 0; i < 3; i += 1) {
    const response = await request(app).post('/api/chat').send({ message: 'Hello!' });
    assert.equal(response.status, 200);
  }

  const blocked = await request(app).post('/api/chat').send({ message: 'Hello!' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'rate_limited');
  assert.match(blocked.body.error.message, /too quickly/i);
});
