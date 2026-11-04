#!/usr/bin/env node
// Lists logged unanswered questions ("coverage gaps", see
// src/services/gapLog.js) so the operator can spot handbook gaps.
//
//   npm run gaps                local data/gaps.jsonl, newest first
//   npm run gaps -- --remote    Cloudflare KV (needs wrangler auth)
//   npm run gaps -- --limit 5   cap the number shown (default 30)
//   npm run gaps -- --json      machine-readable output
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const args = new Set(process.argv.slice(2));
const remote = args.has('--remote');
const asJson = args.has('--json');
const limitIndex = process.argv.indexOf('--limit');
const limit =
  limitIndex >= 0 ? Number.parseInt(process.argv[limitIndex + 1], 10) || 30 : 30;
const prefix = process.env.GAP_LOG_KV_PREFIX || 'gap:';

function parseJsonLines(text) {
  const entries = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines rather than failing the whole report.
    }
  }
  return entries;
}

function printEntries(entries) {
  if (asJson) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log('No unanswered questions logged.');
    return;
  }
  for (const entry of entries) {
    console.log(`${entry.at}  [${entry.mode || 'unknown'}, top score ${entry.topScore ?? 0}]`);
    console.log(`  ${entry.question}`);
    if (entry.topSources?.length) {
      console.log(`  closest: ${entry.topSources.join(' | ')}`);
    }
    console.log('');
  }
  console.log(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
}

function runWrangler(wranglerArgs) {
  const wranglerBin = path.join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!fs.existsSync(wranglerBin)) {
    console.error('Wrangler was not found. Install it first with `npm install`.');
    process.exit(1);
  }
  return spawnSync(process.execPath, [wranglerBin, ...wranglerArgs], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

if (!remote) {
  const file = process.env.GAP_LOG_FILE || path.join(rootDir, 'data', 'gaps.jsonl');
  if (!fs.existsSync(file)) {
    console.log(`No gap log yet at ${path.relative(rootDir, file)}.`);
    console.log(
      'Questions land here when an answer ends in the "I couldn\'t find a clear answer" fallback.'
    );
    process.exit(0);
  }
  const entries = parseJsonLines(fs.readFileSync(file, 'utf8'));
  entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  printEntries(entries.slice(0, limit));
} else {
  const list = runWrangler([
    'kv',
    'key',
    'list',
    '--binding',
    'HANDBOOK_INDEX',
    '--remote',
    '--prefix',
    prefix,
  ]);
  if (list.error || list.status !== 0) {
    console.error(
      list.error
        ? `Could not run Wrangler: ${list.error.message}`
        : String(list.stderr || 'wrangler kv key list failed').trim()
    );
    console.error('Check that you are logged in (`npx wrangler login`).');
    process.exit(1);
  }
  let keys = [];
  try {
    keys = JSON.parse(list.stdout || '[]').map((item) => item.name);
  } catch {
    console.error('Unexpected output from `wrangler kv key list`.');
    process.exit(1);
  }
  // Keys are "gap:<epoch>-<id>", so newest sort last.
  keys.sort();
  const selected = keys.slice(-limit).reverse();
  const entries = [];
  for (const key of selected) {
    const get = runWrangler([
      'kv',
      'key',
      'get',
      key,
      '--binding',
      'HANDBOOK_INDEX',
      '--remote',
      '--text',
    ]);
    if (get.error || get.status !== 0) {
      console.error(`Could not read ${key}: ${String(get.stderr || '').trim()}`);
      continue;
    }
    entries.push(...parseJsonLines(get.stdout));
  }
  if (!asJson) console.log(`Remote KV: ${keys.length} gap key(s), showing ${entries.length}.\n`);
  printEntries(entries);
}
