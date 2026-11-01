#!/usr/bin/env node
// Uploads the locally built handbook index (data/index.json) to the
// HANDBOOK_INDEX Cloudflare KV namespace.
//
//   npm run kv:upload        upload to the deployed (remote) namespace
//   npm run kv:upload:local  write to the local `wrangler dev` store
//
// The index is a local build artifact and is never served as a public file or
// committed to git. Remote uploads need an authenticated Wrangler session
// (`npx wrangler login` or CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const indexFile = path.join(rootDir, 'data', 'index.json');
const KEY = process.env.HANDBOOK_INDEX_KEY || 'handbook-index';
const KV_VALUE_LIMIT_BYTES = 25 * 1024 * 1024;

const args = new Set(process.argv.slice(2));
const local = args.has('--local');
const remote = args.has('--remote');

if (local === remote) {
  console.error('Choose exactly one target: --remote (deployed namespace) or --local (wrangler dev).');
  console.error('  npm run kv:upload');
  console.error('  npm run kv:upload:local');
  process.exit(1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(indexFile)) {
  fail('data/index.json was not found. Build it first with `npm run index`.');
}

const raw = fs.readFileSync(indexFile, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch {
  fail('data/index.json is not valid JSON. Rebuild it with `npm run index`.');
}
if (!Array.isArray(data.chunks) || data.chunks.length === 0) {
  fail('data/index.json contains no chunks. Rebuild it with `npm run index`.');
}

const sizeBytes = Buffer.byteLength(raw, 'utf8');
if (sizeBytes > KV_VALUE_LIMIT_BYTES) {
  fail(
    `The index is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB, above the 25 MB KV value limit.`
  );
}

const provider = data.embedding && data.embedding.provider;
if (provider !== 'nvidia') {
  console.warn(
    [
      '',
      `Note: this index was built with "${provider || 'unknown'}" embeddings.`,
      'The Worker never loads local ONNX models, so it will search with BM25',
      'keywords only. To enable semantic search, rebuild and re-upload:',
      '',
      '  $env:EMBEDDING_PROVIDER="nvidia"   # PowerShell (bash: EMBEDDING_PROVIDER=nvidia)',
      '  npm run index',
      '  npm run kv:upload',
      '',
    ].join('\n')
  );
}

const vectorCount = Array.isArray(data.vectors) ? data.vectors.length : 0;
console.log(
  [
    `${local ? 'Local' : 'Remote'} KV upload`,
    `  binding: HANDBOOK_INDEX`,
    `  key:     ${KEY}`,
    `  file:    data/index.json (${(sizeBytes / 1024).toFixed(0)} KB)`,
    `  chunks:  ${data.chunks.length}, vectors: ${vectorCount}`,
    `  built:   ${data.meta && data.meta.generatedAt ? data.meta.generatedAt : 'unknown'}`,
    '',
  ].join('\n')
);

// Invoke Wrangler's own entry point with the current Node binary. This avoids
// shell quirks on Windows and keeps working when the project path contains
// spaces.
const wranglerBin = path.join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!fs.existsSync(wranglerBin)) {
  fail('Wrangler was not found. Install it first with `npm install`.');
}

const result = spawnSync(
  process.execPath,
  [
    wranglerBin,
    'kv',
    'key',
    'put',
    KEY,
    '--path',
    path.join('data', 'index.json'),
    '--binding',
    'HANDBOOK_INDEX',
    local ? '--local' : '--remote',
  ],
  { cwd: rootDir, stdio: 'inherit' }
);

if (result.error) {
  fail(`Could not run Wrangler: ${result.error.message}. Install it with \`npm install\`.`);
}
if (result.status !== 0) {
  fail(
    [
      'Wrangler could not upload the index.',
      local
        ? 'Run `npm install` so Wrangler is available.'
        : 'Check that you are logged in (`npx wrangler login`) and that the',
      local ? '' : 'HANDBOOK_INDEX namespace id in wrangler.jsonc is correct.',
    ]
      .filter(Boolean)
      .join('\n')
  );
}

console.log(
  local
    ? 'Uploaded. Start the Worker locally with `npm run dev:worker`.'
    : 'Uploaded. Deploy with `npx wrangler deploy` (or redeploy to pick up the new index).'
);
