import path from 'node:path';
import { config } from '../config/index.js';

// The module name is kept in a variable so the bundler does not try to bundle
// the ONNX runtime (@huggingface/transformers) into the Cloudflare Worker. The
// import is only ever executed by the local Node server and build scripts.
const LOCAL_TRANSFORMERS_MODULE = '@huggingface/transformers';

let localExtractorPromise = null;
let localExtractorModel = null;

function normalise(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return vector.map((value) => value / norm);
}

async function getLocalExtractor(model) {
  if (config.isWorker) {
    // Local embeddings need the ONNX runtime, a model download, and far more
    // memory and CPU than the free plan allows. Query embeddings in the Worker
    // must come from a provider API (EMBEDDING_PROVIDER=nvidia).
    throw new Error(
      'Local embedding models are not available in the Cloudflare Worker. Rebuild the index with EMBEDDING_PROVIDER=nvidia to enable semantic search.'
    );
  }
  if (localExtractorPromise && localExtractorModel === model) return localExtractorPromise;
  localExtractorModel = model;
  localExtractorPromise = (async () => {
    const fs = await import('node:fs/promises');
    const { pipeline, env } = await import(LOCAL_TRANSFORMERS_MODULE);
    await fs.mkdir(path.join(config.dataDir, 'models'), { recursive: true });
    env.cacheDir = path.join(config.dataDir, 'models');
    env.allowRemoteModels = true;
    return pipeline('feature-extraction', model, { dtype: 'q8', device: 'cpu' });
  })();
  try {
    return await localExtractorPromise;
  } catch (error) {
    localExtractorPromise = null;
    localExtractorModel = null;
    throw error;
  }
}

async function embedLocal(texts, model, { query = false } = {}) {
  const extractor = await getLocalExtractor(model);
  const needsPrefix = /(^|\/)e5/i.test(model);
  const input = needsPrefix
    ? texts.map((text) => `${query ? 'query' : 'passage'}: ${text}`)
    : texts;
  const output = await extractor(input, { pooling: 'mean', normalize: true });
  return output.tolist().map(normalise);
}

async function embedNvidia(texts, { model, apiKey, baseUrl, timeoutMs, query }) {
  if (!apiKey) {
    throw new Error('No embedding API key is configured.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        input: texts,
        model,
        input_type: query ? 'query' : 'passage',
        encoding_format: 'float',
        truncate: 'END',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Embedding provider returned HTTP ${response.status}.`);
    }
    const data = await response.json();
    if (!Array.isArray(data?.data) || data.data.length !== texts.length) {
      throw new Error('Embedding provider returned an unexpected response.');
    }
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => normalise(item.embedding));
  } finally {
    clearTimeout(timer);
  }
}

export async function embedTexts(texts, { provider, model, query = false, onProgress } = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const selectedProvider = provider || config.embeddings.provider;
  const selectedModel =
    model ||
    (selectedProvider === 'nvidia' ? config.embeddings.nvidiaModel : config.embeddings.localModel);

  if (selectedProvider === 'nvidia') {
    const vectors = [];
    const batchSize = 16;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchVectors = await embedNvidia(batch, {
        model: selectedModel,
        apiKey: config.embeddings.apiKey,
        baseUrl: config.embeddings.baseUrl,
        timeoutMs: config.embeddings.timeoutMs,
        query,
      });
      vectors.push(...batchVectors);
      onProgress?.(Math.min(texts.length, i + batch.length), texts.length);
    }
    return vectors;
  }

  const vectors = [];
  const batchSize = 16;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    vectors.push(...(await embedLocal(batch, selectedModel, { query })));
    onProgress?.(Math.min(texts.length, i + batch.length), texts.length);
  }
  return vectors;
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

export function resetEmbeddingCache() {
  localExtractorPromise = null;
  localExtractorModel = null;
}
