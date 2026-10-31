import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseImage,
  chatCompletion,
  ProviderError,
  streamChatCompletion,
  __testing,
} from '../src/services/aiProvider.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function successBody(content = 'Grounded answer.') {
  return {
    model: 'test-model',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  };
}

function sseResponse(text, { status = 200 } = {}) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({
    start(controller) {
      // Deliberately split in small pieces so the parser must handle events that
      // arrive across chunk boundaries.
      for (let index = 0; index < bytes.length; index += 17) {
        controller.enqueue(bytes.slice(index, index + 17));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('endpoint construction supports base URLs and full completion URLs', () => {
  assert.equal(
    __testing.endpointFromBaseUrl('https://integrate.api.nvidia.com/v1'),
    'https://integrate.api.nvidia.com/v1/chat/completions'
  );
  assert.equal(
    __testing.endpointFromBaseUrl('https://integrate.api.nvidia.com/v1/'),
    'https://integrate.api.nvidia.com/v1/chat/completions'
  );
  assert.equal(
    __testing.endpointFromBaseUrl('https://example.com/v1/chat/completions'),
    'https://example.com/v1/chat/completions'
  );
});

test('a successful chat completion sends the expected request and returns usage', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return jsonResponse(successBody());
  };

  const result = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
    timeoutMs: 5000,
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].body.model, 'test-model');
  assert.equal(calls[0].body.stream, false);
  assert.equal(result.content, 'Grounded answer.');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage.totalTokens, 18);
  assert.equal(result.model, 'test-model');
});

test('missing credentials fail safely without making a network request', async () => {
  let called = false;
  const error = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: '',
    baseUrl: 'https://example.com/v1',
    fetchImpl: async () => {
      called = true;
      return jsonResponse(successBody());
    },
  }).catch((caught) => caught);

  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, 'not_configured');
  assert.equal(error.status, 503);
  assert.equal(called, false);
});

test('authentication failures are mapped and not retried', async () => {
  const calls = [];
  const fetchImpl = async () => {
    calls.push('call');
    return jsonResponse({ error: { message: 'invalid key' } }, 401);
  };

  const error = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'bad-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 1,
    retryDelayMs: 0,
    fetchImpl,
  }).catch((caught) => caught);

  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, 'auth_error');
  assert.equal(error.status, 502);
  assert.match(error.message, /AI_API_KEY/);
  assert.equal(calls.length, 1);
});

test('a retired model is reported with the provider explanation, not a generic error', async () => {
  const error = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 1,
    retryDelayMs: 0,
    fetchImpl: async () =>
      jsonResponse(
        {
          type: 'about:blank',
          title: 'Gone',
          status: 410,
          detail:
            "The model 'meta/llama-3.3-70b-instruct' has reached its end of life on 2026-08-26T09:00:00Z and is no longer available.",
        },
        410
      ),
  }).catch((caught) => caught);

  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, 'model_retired');
  assert.equal(error.status, 502);
  assert.match(error.message, /no longer available/);
  assert.match(error.message, /AI_MODEL/);
  assert.match(error.message, /end of life/);
});

test('a transient model 404 is retried, and a persistent one still fails clearly', async () => {
  let calls = 0;
  const recovered = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 1,
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ detail: 'Not Found' }, 404);
      return jsonResponse({
        choices: [{ message: { content: 'Recovered.' }, finish_reason: 'stop' }],
        model: 'test/model',
        usage: null,
      });
    },
  });
  assert.equal(recovered.content, 'Recovered.');
  assert.equal(calls, 2);

  let attempts = 0;
  const persistent = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 1,
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse({ detail: 'Not Found' }, 404);
    },
  }).catch((caught) => caught);

  assert.ok(persistent instanceof ProviderError);
  assert.equal(persistent.code, 'model_not_found');
  assert.match(persistent.message, /AI_MODEL/);
  assert.equal(attempts, 2);
});

test('provider error detail never echoes credential-shaped text', async () => {
  const error = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 0,
    retryDelayMs: 0,
    fetchImpl: async () =>
      jsonResponse(
        { detail: 'Rejected key nvapi-abcdefghijklmnopqrstuvwxyz012345 sent as Bearer abcdefghijklmnop' },
        400
      ),
  }).catch((caught) => caught);

  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, 'bad_request');
  assert.doesNotMatch(error.message, /nvapi-abcdefghijklmnopqrstuvwxyz012345/);
  assert.doesNotMatch(error.message, /abcdefghijklmnop/);
  assert.match(error.message, /\[redacted\]/);
});

test('a reasoning model that spends its whole budget is reported clearly', async () => {
  const error = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 0,
    fetchImpl: async () =>
      jsonResponse({
        choices: [
          { message: { role: 'assistant', content: '', reasoning_content: 'thinking…' }, finish_reason: 'length' },
        ],
        usage: {
          completion_tokens: 900,
          completion_tokens_details: { reasoning_tokens: 900 },
        },
      }),
  }).catch((caught) => caught);

  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, 'output_truncated');
  assert.match(error.message, /reasoning model/i);
  assert.match(error.message, /AI_MAX_OUTPUT_TOKENS/);
});

test('a truncated reasoning answer is retried and can recover', async () => {
  let attempt = 0;
  const result = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 1,
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse({
          choices: [
            { message: { role: 'assistant', content: '', reasoning_content: 'thinking…' }, finish_reason: 'length' },
          ],
        });
      }
      return jsonResponse(successBody('Recovered after truncation.'));
    },
  });
  assert.equal(result.content, 'Recovered after truncation.');
  assert.equal(attempt, 2);
});

test('rate limits and transient server errors are retried once', async () => {
  let attempt = 0;
  const fetchImpl = async () => {
    attempt += 1;
    if (attempt === 1) {
      return jsonResponse({ error: { message: 'slow down' } }, 429, { 'retry-after': '0' });
    }
    return jsonResponse(successBody('Recovered.'));
  };

  const result = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 1,
    retryDelayMs: 0,
    fetchImpl,
  });

  assert.equal(attempt, 2);
  assert.equal(result.content, 'Recovered.');
});

test('repeated provider outages are reported after retries are exhausted', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ error: { message: 'unavailable' } }, 503);
  };

  const error = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 1,
    retryDelayMs: 0,
    fetchImpl,
  }).catch((caught) => caught);

  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, 'provider_unavailable');
  assert.equal(calls, 2);
});

test('timeouts become a clear 504 error without retrying', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };

  const error = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 1,
    retryDelayMs: 0,
    timeoutMs: 10,
    fetchImpl,
  }).catch((caught) => caught);

  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, 'timeout');
  assert.equal(error.status, 504);
  assert.match(error.message, /did not respond in time/i);
  assert.equal(calls, 1);
});

test('network failures retry and then map to a network error', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('ECONNRESET');
  };

  const error = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 1,
    retryDelayMs: 0,
    fetchImpl,
  }).catch((caught) => caught);

  assert.ok(error instanceof ProviderError);
  assert.equal(error.code, 'network_error');
  assert.equal(calls, 2);
});

test('malformed and empty provider responses are rejected', async () => {
  const malformed = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 0,
    fetchImpl: async () => new Response('not json', { status: 200 }),
  }).catch((caught) => caught);
  assert.equal(malformed.code, 'bad_response');

  const empty = await chatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    maxRetries: 0,
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '   ' } }] }),
  }).catch((caught) => caught);
  assert.equal(empty.code, 'bad_response');
  assert.equal(empty.status, 502);
});

test('streaming completions emit deltas and assemble the full answer', async () => {
  const deltas = [];
  let captured = null;
  const fetchImpl = async (_url, options) => {
    captured = JSON.parse(options.body);
    return sseResponse(
      [
        'data: {"model":"stream-model","choices":[{"delta":{"content":"Grounded "},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"delta":{"content":"answer."},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
        '',
      ].join('\n')
    );
  };

  const result = await streamChatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
    timeoutMs: 5000,
    onDelta: (text) => deltas.push(text),
    fetchImpl,
  });

  assert.equal(captured.stream, true);
  assert.deepEqual(deltas, ['Grounded ', 'answer.']);
  assert.equal(result.content, 'Grounded answer.');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.model, 'stream-model');
});

test('streaming falls back to a JSON completion when the provider ignores stream=true', async () => {
  const deltas = [];
  const result = await streamChatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
    onDelta: (text) => deltas.push(text),
    fetchImpl: async () => jsonResponse(successBody('Fallback answer.')),
  });

  assert.deepEqual(deltas, ['Fallback answer.']);
  assert.equal(result.content, 'Fallback answer.');
  assert.equal(result.finishReason, 'stop');
});

test('vision analysis sends one user message with the image data URL', async () => {
  let captured = null;
  const fetchImpl = async (_url, options) => {
    captured = JSON.parse(options.body);
    return jsonResponse(successBody('Visible text: Bring your ID.'));
  };

  const result = await analyseImage({
    question: 'What does this notice say?',
    attachment: {
      buffer: Buffer.from([1, 2, 3, 4]),
      mimeType: 'image/png',
    },
    model: 'vision-test',
    apiKey: 'test-key',
    fetchImpl,
  });

  assert.equal(captured.model, 'vision-test');
  assert.equal(captured.messages.length, 1);
  assert.equal(captured.messages[0].role, 'user');
  const parts = captured.messages[0].content;
  assert.ok(parts.some((part) => part.type === 'text'));
  const image = parts.find((part) => part.type === 'image_url');
  assert.ok(image);
  assert.match(image.image_url.url, /^data:image\/png;base64,/);
  assert.equal(result.analysis, 'Visible text: Bring your ID.');
});

test('invalid image inputs are rejected before calling the provider', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return jsonResponse(successBody());
  };

  const missing = await analyseImage({
    question: 'Read this',
    attachment: null,
    fetchImpl,
  }).catch((caught) => caught);
  assert.equal(missing.code, 'invalid_image');
  assert.equal(called, false);

  const unsupported = await analyseImage({
    question: 'Read this',
    attachment: { buffer: Buffer.from([1]), mimeType: 'image/gif' },
    fetchImpl,
  }).catch((caught) => caught);
  assert.equal(unsupported.code, 'unsupported_image');
  assert.equal(unsupported.status, 415);
  assert.equal(called, false);
});
