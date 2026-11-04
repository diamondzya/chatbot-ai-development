import { config } from '../config/index.js';
import { buildVisionMessages } from './promptBuilder.js';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class ProviderError extends Error {
  constructor(code, message, { status = 502, retryable = false, cause = undefined } = {}) {
    super(message, { cause });
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.expose = true;
  }
}

function endpointFromBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '');
  if (!normalized) return '';
  return /\/chat\/completions$/i.test(normalized)
    ? normalized
    : `${normalized}/chat/completions`;
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(response) {
  const value = response.headers?.get?.('retry-after');
  if (!value) return 0;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000);
  return 0;
}

const PROVIDER_DETAIL_MAX = 200;

// Provider error bodies are aimed at the account holder, but never echo
// anything shaped like a credential back to the browser.
const SECRET_LIKE =
  /\b(?:nvapi|sk|xai|gsk|hf|ghp)[-_][A-Za-z0-9_-]{8,}\b|\bBearer\s+[A-Za-z0-9._-]{12,}/gi;

function safeProviderDetail(data) {
  const detail = data?.detail ?? data?.error?.message ?? data?.message;
  if (typeof detail !== 'string') return '';
  const cleaned = detail
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(SECRET_LIKE, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > PROVIDER_DETAIL_MAX
    ? `${cleaned.slice(0, PROVIDER_DETAIL_MAX - 1)}…`
    : cleaned;
}

function providerErrorForStatus(status, response, data = null) {
  if (status === 401 || status === 403) {
    return new ProviderError(
      'auth_error',
      'The AI provider rejected the API credentials. Check AI_API_KEY and the provider account, then try again.',
      { status: 502 }
    );
  }
  if (status === 410) {
    const detail = safeProviderDetail(data);
    return new ProviderError(
      'model_retired',
      `The configured AI model is no longer available${detail ? ` — ${detail}` : ''} Choose a supported model ID for AI_MODEL (see the README) and restart the server.`,
      { status: 502 }
    );
  }
  if (status === 404) {
    const detail = safeProviderDetail(data);
    return new ProviderError(
      'model_not_found',
      `The configured AI model or endpoint was not found${detail ? ` — ${detail}` : ''} Check AI_MODEL and AI_BASE_URL, then try again.`,
      // NVIDIA's gateway returned transient 404s for a valid model during live
      // verification, so retry once before giving up. A genuinely wrong model
      // ID still fails fast (each attempt is a quick 404).
      { status: 502, retryable: true }
    );
  }
  if (status === 413) {
    return new ProviderError(
      'image_too_large',
      'The image is too large for the AI provider. Try a smaller image or a lower-resolution screenshot.',
      { status: 413 }
    );
  }
  if (status === 422) {
    return new ProviderError(
      'invalid_input',
      'The AI provider could not process this input. Check that the selected model supports the input type, then try again.',
      { status: 422 }
    );
  }
  if (status === 429) {
    return new ProviderError(
      'rate_limited',
      'The AI provider is rate-limiting requests. Please wait a moment and try again.',
      { status: 429, retryable: true }
    );
  }
  if (status === 400) {
    const detail = safeProviderDetail(data);
    return new ProviderError(
      'bad_request',
      `The AI provider rejected the request${detail ? ` — ${detail}` : ''} Check the configured model and whether it supports this input, then try again.`,
      { status: 502 }
    );
  }
  if (status >= 500) {
    return new ProviderError(
      'provider_unavailable',
      'The AI provider is temporarily unavailable. Please try again shortly.',
      { status: 502, retryable: true }
    );
  }
  const retryAfter = parseRetryAfter(response);
  return new ProviderError(
    'provider_error',
    `The AI provider returned an unexpected response (HTTP ${status}). Please try again.`,
    { status: 502, retryable: retryAfter > 0 }
  );
}

function extractContent(data) {
  const choice = data?.choices?.[0];
  if (!choice || typeof choice !== 'object') return null;
  const message = choice.message;
  if (!message || typeof message !== 'object') return null;
  let content = message.content;
  if (Array.isArray(content)) {
    content = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  if (typeof content !== 'string' || !content.trim()) return null;
  return {
    content: content.trim(),
    finishReason: choice.finish_reason || null,
  };
}

function assertChatConfiguration({ messages, apiKey, baseUrl, model, fetchImpl }) {
  if (!apiKey) {
    throw new ProviderError(
      'not_configured',
      'No AI API key is configured. Add AI_API_KEY to .env and restart the server. The local demo will continue to work without a key.',
      { status: 503 }
    );
  }
  if (!baseUrl) {
    throw new ProviderError(
      'not_configured',
      'No AI base URL is configured. Set AI_BASE_URL to the provider endpoint.',
      { status: 503 }
    );
  }
  if (!model) {
    throw new ProviderError(
      'not_configured',
      'No AI model is configured. Set AI_MODEL to a supported model ID.',
      { status: 503 }
    );
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ProviderError('invalid_request', 'The AI request did not contain any messages.', {
      status: 500,
    });
  }
  if (typeof fetchImpl !== 'function') {
    throw new ProviderError('network_error', 'The server could not make an outbound request.', {
      status: 502,
    });
  }

  const endpoint = endpointFromBaseUrl(baseUrl);
  if (!endpoint) {
    throw new ProviderError('not_configured', 'The configured AI base URL is invalid.', {
      status: 503,
    });
  }
  return endpoint;
}

function truncatedOutputError() {
  return new ProviderError(
    'output_truncated',
    'The AI model used its entire output limit before writing a visible answer. This usually means the configured model is a reasoning model — choose a model that answers directly, or raise AI_MAX_OUTPUT_TOKENS.',
    // Reasoning models burn the whole budget intermittently (observed live with
    // the Nemotron VL model), so one retry usually recovers the answer.
    { status: 502, retryable: true }
  );
}

function usageFrom(data) {
  return {
    promptTokens: data?.usage?.prompt_tokens ?? null,
    completionTokens: data?.usage?.completion_tokens ?? null,
    totalTokens: data?.usage?.total_tokens ?? null,
  };
}

function normaliseDeltaContent(delta) {
  let content = delta?.content;
  if (Array.isArray(content)) {
    content = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return typeof content === 'string' ? content : '';
}

/**
 * Call an OpenAI-compatible chat-completions endpoint.
 *
 * The NVIDIA NIM hosted endpoint is OpenAI-compatible:
 *   POST https://integrate.api.nvidia.com/v1/chat/completions
 *
 * The non-streamed call is sent with stream=true internally: reasoning models
 * can withhold a non-streamed answer for minutes while the identical streamed
 * request starts right away and keeps advancing (the idle timeout resets on
 * every chunk). Callers still receive the fully assembled answer.
 */
export async function chatCompletion({
  messages,
  model = config.ai.model,
  apiKey = config.ai.apiKey,
  baseUrl = config.ai.baseUrl,
  timeoutMs = config.ai.timeoutMs,
  maxTokens = config.ai.maxOutputTokens,
  temperature = config.ai.temperature,
  maxRetries = 1,
  retryDelayMs = 700,
  fetchImpl = globalThis.fetch,
} = {}) {
  return streamChatCompletion({
    messages,
    model,
    apiKey,
    baseUrl,
    timeoutMs,
    maxTokens,
    temperature,
    maxRetries,
    retryDelayMs,
    fetchImpl,
    onDelta: () => {},
  });
}

/**
 * Streaming variant of {@link chatCompletion}.
 *
 * Yields visible text through `onDelta` as the provider emits it and returns the
 * same shape as the non-streaming call once the stream ends. Retries are only
 * allowed before the first token: repeating a partly streamed answer would
 * duplicate text the student has already seen.
 */
export async function streamChatCompletion({
  messages,
  model = config.ai.model,
  apiKey = config.ai.apiKey,
  baseUrl = config.ai.baseUrl,
  timeoutMs = config.ai.timeoutMs,
  maxTokens = config.ai.maxOutputTokens,
  temperature = config.ai.temperature,
  maxRetries = 1,
  retryDelayMs = 700,
  onDelta = () => {},
  signal: externalSignal = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const endpoint = assertChatConfiguration({ messages, apiKey, baseUrl, model, fetchImpl });
  const body = JSON.stringify({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  });

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const timeoutController = new AbortController();
    // Streaming uses an idle timeout: the clock resets every time the provider
    // sends data. A reasoning model can stream hidden `reasoning_content` for a
    // long time before the visible answer starts, and a single total timeout
    // aborted those slow-but-progressing requests (observed live at ~82 s under
    // load) even though the model was working. A silent provider is still cut
    // off after `timeoutMs` without a single byte.
    let idleTimer = null;
    const armIdleTimeout = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => timeoutController.abort(), timeoutMs);
    };
    armIdleTimeout();
    const signal =
      externalSignal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([timeoutController.signal, externalSignal])
        : timeoutController.signal;
    let received = false;
    let content = '';

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body,
        signal,
      });

      // The provider answered with headers; give it a fresh window to stream
      // the body.
      armIdleTimeout();

      if (!response.ok) {
        const raw = await response.text();
        let data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
        }
        const mapped = providerErrorForStatus(response.status, response, data);
        if (mapped.retryable && attempt < maxRetries) {
          lastError = mapped;
          await sleep(parseRetryAfter(response) || retryDelayMs * 2 ** attempt);
          continue;
        }
        throw mapped;
      }

      const contentType = String(response.headers?.get?.('content-type') || '');
      if (!contentType.includes('text/event-stream')) {
        // Some OpenAI-compatible providers ignore stream=true and reply with a
        // normal JSON completion. Treat its content as one delta.
        const raw = await response.text();
        let data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
        }
        if (!data) {
          throw new ProviderError(
            'bad_response',
            'The AI provider returned a response that was not valid JSON. Please try again.',
            { status: 502 }
          );
        }
        const extracted = extractContent(data);
        if (!extracted) {
          if (data?.choices?.[0]?.finish_reason === 'length') throw truncatedOutputError();
          throw new ProviderError(
            'bad_response',
            'The AI provider returned an empty or malformed response. Please try again.',
            { status: 502 }
          );
        }
        await onDelta(extracted.content);
        return {
          content: extracted.content,
          finishReason: extracted.finishReason,
          model: data.model || model,
          usage: usageFrom(data),
        };
      }

      if (!response.body || typeof response.body.getReader !== 'function') {
        throw new ProviderError(
          'bad_response',
          'The AI provider returned a stream that could not be read. Please try again.',
          { status: 502 }
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finishReason = null;
      let responseModel = model;
      let usage = null;
      let done = false;

      const consumeBlock = async (block) => {
        const dataLines = [];
        for (const line of String(block).split('\n')) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length === 0) return;
        const payloadText = dataLines.join('\n');
        if (payloadText === '[DONE]') {
          done = true;
          return;
        }
        let payload = null;
        try {
          payload = JSON.parse(payloadText);
        } catch {
          return;
        }
        if (payload?.error) {
          const detail = safeProviderDetail(payload);
          throw new ProviderError(
            'provider_error',
            `The AI provider reported an error${detail ? ` — ${detail}` : ''} Please try again.`,
            { status: 502 }
          );
        }
        if (payload?.model) responseModel = payload.model;
        if (payload?.usage) usage = usageFrom(payload);
        const choice = payload?.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const text = normaliseDeltaContent(choice.delta ?? choice.message);
        if (text) {
          content += text;
          received = true;
          await onDelta(text);
        }
      };

      try {
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          // Bytes keep arriving, so the provider is still working.
          armIdleTimeout();
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r\n/g, '\n');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            await consumeBlock(block);
            if (done) break;
          }
        }
        buffer = buffer.replace(/\r\n/g, '\n');
        if (!done && buffer.trim()) await consumeBlock(buffer);
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // The stream may already be closed.
        }
      }

      if (!content.trim()) {
        if (finishReason === 'length') throw truncatedOutputError();
        throw new ProviderError(
          'bad_response',
          'The AI provider returned an empty or malformed response. Please try again.',
          { status: 502 }
        );
      }

      return {
        content: content.trim(),
        finishReason,
        model: responseModel,
        usage: usage || { promptTokens: null, completionTokens: null, totalTokens: null },
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        if (!received && error.retryable && attempt < maxRetries) {
          lastError = error;
          await sleep(retryDelayMs * 2 ** attempt);
          continue;
        }
        throw error;
      }
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        if (externalSignal?.aborted) {
          throw new ProviderError('aborted', 'The request was cancelled.', {
            status: 499,
            cause: error,
          });
        }
        lastError = new ProviderError(
          'timeout',
          'The AI provider did not respond in time. Please try again in a moment.',
          { status: 504, retryable: true, cause: error }
        );
        // A retry is only safe before the first visible token: repeating a
        // partly streamed answer would duplicate text the student already saw.
        if (!received && attempt < maxRetries) {
          await sleep(retryDelayMs * 2 ** attempt);
          continue;
        }
        throw lastError;
      }
      lastError = new ProviderError(
        'network_error',
        'The server could not reach the AI provider. Check the network connection and try again.',
        { status: 502, retryable: true, cause: error }
      );
      if (!received && attempt < maxRetries) {
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(idleTimer);
    }
  }

  throw (
    lastError ||
    new ProviderError('provider_unavailable', 'The AI provider is temporarily unavailable.', {
      status: 502,
      retryable: true,
    })
  );
}

/**
 * Ask the configured vision model to transcribe/describe an image. This is a
 * separate extraction step; policy reasoning is left to the text model using
 * retrieved handbook passages.
 */
export async function analyseImage({
  question,
  attachment,
  model = config.ai.visionModel,
  apiKey = config.ai.apiKey,
  timeoutMs = config.ai.timeoutMs,
  maxTokens = config.ai.visionMaxOutputTokens,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!attachment || !Buffer.isBuffer(attachment.buffer) || attachment.buffer.length === 0) {
    throw new ProviderError('invalid_image', 'No image data was provided for analysis.', {
      status: 400,
    });
  }
  if (!/^image\/(?:jpeg|png|webp)$/i.test(attachment.mimeType || '')) {
    throw new ProviderError('unsupported_image', 'The uploaded image format is not supported.', {
      status: 415,
    });
  }

  const dataUrl = `data:${attachment.mimeType};base64,${attachment.buffer.toString('base64')}`;
  const messages = buildVisionMessages({ question, imageDataUrl: dataUrl });
  const response = await chatCompletion({
    messages,
    model,
    apiKey,
    timeoutMs,
    maxTokens,
    temperature: 0,
    maxRetries: 1,
    fetchImpl,
  });

  return {
    analysis: response.content,
    model: response.model,
    usage: response.usage,
  };
}

export const __testing = { endpointFromBaseUrl, extractContent, providerErrorForStatus };
