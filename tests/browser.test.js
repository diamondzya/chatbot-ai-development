/* ==========================================================================
   Headless-browser checks for the client behaviors that unit tests cannot see:
   streaming answers, citation links, follow-up chips, the theme menu, and the
   quick-actions palette.

   Uses the Chrome DevTools Protocol directly (no test framework dependency).
   Skips itself when no Chromium-based browser or no global WebSocket exists,
   so `npm test` stays green on machines without a browser.
   ========================================================================== */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BROWSER_CANDIDATES = [
  process.env.BROWSER_PATH,
  process.env.CI ? '/usr/bin/google-chrome' : null,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const browserPath = BROWSER_CANDIDATES.find((candidate) => {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
});

const canRun = Boolean(browserPath) && typeof WebSocket === 'function';
const skip = canRun ? false : `no Chromium browser or global WebSocket available (${process.platform})`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let server;
let browser;
let profileDir;
let ws;
let sequence = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    sequence += 1;
    const id = sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 20000).unref?.();
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const details = response?.result?.exceptionDetails;
  if (details) throw new Error(`Page error: ${JSON.stringify(details)}`);
  return response?.result?.result?.value;
}

async function waitFor(expression, timeoutMs = 12000, label = expression) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch {
      // Page still navigating; retry.
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function navigate(url) {
  await send('Page.navigate', { url });
  await waitFor('document.readyState === "complete"', 15000, 'page load');
  await waitFor('Boolean(document.getElementById("startCards"))', 15000, 'app shell');
}

async function ask(question) {
  await evaluate(`(() => {
    const input = document.getElementById('messageInput');
    input.value = ${JSON.stringify(question)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();
    return true;
  })()`);
  await waitFor(
    `(() => {
      // The send button is disabled whenever the input is empty, so "is-busy"
      // (not disabled) is the signal that the answer has finished.
      const busy = document.getElementById('sendBtn').classList.contains('is-busy');
      return !busy && document.querySelectorAll('.message.assistant .bubble').length > 0;
    })()`,
    20000,
    'answer rendered'
  );
}

before(async () => {
  if (!canRun) return;

  process.env.NODE_ENV = 'test';
  process.env.AI_API_KEY = '';
  process.env.ENABLE_DENSE_RETRIEVAL = 'false';
  process.env.RATE_LIMIT_API_PER_MINUTE = '1000';
  process.env.RATE_LIMIT_CHAT_PER_MINUTE = '200';

  const { createApp } = await import('../src/app.js');
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  globalThis.__stiTestUrl = `http://127.0.0.1:${port}/`;

  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sti-browser-test-'));
  const debugPort = 9377;
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];
  if (process.env.CI) args.unshift('--no-sandbox');
  browser = spawn(browserPath, args, { stdio: 'ignore' });

  let version = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error('The headless browser did not start.');

  let target = null;
  for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    target = targets.find((item) => item.type === 'page');
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('No browser page target found.');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message);
    }
  };

  await send('Runtime.enable');
  await send('Page.enable');
});

after(async () => {
  try {
    ws?.close();
  } catch {
    /* already closed */
  }
  if (browser) {
    browser.kill();
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (profileDir) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* Windows may still hold the profile briefly. */
    }
  }
});

test('the client renders the welcome state without horizontal overflow', { skip }, async () => {
  await navigate(globalThis.__stiTestUrl);
  const state = await evaluate(`({
    cards: document.querySelectorAll('#startCards .start-card').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    theme: document.documentElement.getAttribute('data-theme') || 'light',
  })`);
  assert.ok(state.cards >= 4, `expected suggestion cards, got ${state.cards}`);
  assert.equal(state.overflow, false);
});

test('answers render with sources, citation links, and follow-up chips', { skip }, async () => {
  await ask('What should I do if I forget my school ID?');
  const state = await evaluate(`({
    sources: document.querySelectorAll('.message.assistant .source-card').length,
    pdfLink: (document.querySelector('.message.assistant .source-link') || {}).getAttribute
      ? document.querySelector('.message.assistant .source-link').getAttribute('href')
      : null,
    cites: document.querySelectorAll('.message.assistant .cite-link').length,
    followUps: document.querySelectorAll('.message.assistant .follow-up').length,
    label: document.body.innerText.includes('not AI'),
  })`);
  assert.ok(state.sources >= 1, 'expected at least one source card');
  assert.match(String(state.pdfLink), /#page=\d+/);
  assert.ok(state.cites >= 1, 'expected at least one clickable citation');
  assert.ok(state.followUps >= 1, 'expected at least one follow-up chip');
  assert.equal(state.label, true, 'the non-AI label must be visible');
});

test('clicking a citation reveals its source card', { skip }, async () => {
  const opened = await evaluate(`(() => {
    const cite = document.querySelector('.message.assistant .cite-link');
    if (!cite) return 'missing';
    cite.click();
    const card = document.querySelector(
      '.message.assistant .source-card[data-page="' + cite.dataset.page + '"]'
    );
    return card ? card.open : 'no-card';
  })()`);
  assert.equal(opened, true);
});

test('the theme menu applies dark mode and persists it across reloads', { skip }, async () => {
  await evaluate(`document.getElementById('themeBtn').click()`);
  await waitFor('!document.getElementById("themeMenu").hidden', 4000, 'theme menu opens');
  await evaluate(`document.querySelector('[data-theme-choice="dark"]').click()`);
  const afterClick = await evaluate(`({
    theme: document.documentElement.getAttribute('data-theme'),
    stored: localStorage.getItem('sti-theme'),
  })`);
  assert.equal(afterClick.theme, 'dark');
  assert.equal(afterClick.stored, 'dark');

  await navigate(globalThis.__stiTestUrl);
  const reloaded = await evaluate(`document.documentElement.getAttribute('data-theme')`);
  assert.equal(reloaded, 'dark');

  // Put the theme back for the remaining tests.
  await evaluate(`localStorage.setItem('sti-theme', 'light')`);
});

test('Ctrl+K opens the palette and can switch the theme', { skip }, async () => {
  await navigate(globalThis.__stiTestUrl);
  await evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    return true;
  })()`);
  await waitFor('!document.getElementById("paletteBackdrop").hidden', 4000, 'palette opens');

  await evaluate(`(() => {
    const input = document.getElementById('paletteInput');
    input.value = 'theme: dark';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await waitFor(
    'document.documentElement.getAttribute("data-theme") === "dark"',
    4000,
    'palette action applied'
  );
  assert.equal(
    await evaluate('document.getElementById("paletteBackdrop").hidden'),
    true,
    'palette closes after running an action'
  );
});

test('handbook-only toggle stays hidden while the server is in demo mode', { skip }, async () => {
  const hidden = await evaluate(`document.getElementById('excerptsToggle').hidden`);
  assert.equal(hidden, true);
});
