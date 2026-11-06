/* ==========================================================================
   Headless-browser checks for the client behaviors that unit tests cannot see:
   the home-to-chat flow, first-visit terms gate, streaming answers, citation
   links, follow-up chips, the theme menu, and the quick-actions palette.

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

async function acceptTermsIfShown() {
  const shown = await evaluate(`(() => {
    const checkbox = document.getElementById('termsAgreeCheck');
    if (!checkbox || document.getElementById('modalBackdrop').hidden) return false;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('termsAgreeBtn').click();
    return true;
  })()`);
  if (shown) {
    await waitFor('document.getElementById("modalBackdrop").hidden', 4000, 'terms accepted');
  }
  return shown;
}

async function navigate(url, { acceptTerms = true } = {}) {
  // Wait for the new document, including when navigating to the same URL.
  await evaluate('window.__stiLeaving = true');
  await send('Page.navigate', { url });
  await waitFor('window.__stiLeaving !== true && document.readyState === "complete"', 15000, 'page load');
  await waitFor('Boolean(document.getElementById("startCards") || document.getElementById("homeMain"))', 15000, 'page shell');
  if (acceptTerms) await acceptTermsIfShown();
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
  process.env.AI_API_KEY = 'replace_with_your_actual_key';
  process.env.ENABLE_DENSE_RETRIEVAL = 'false';
  process.env.RATE_LIMIT_API_PER_MINUTE = '1000';
  process.env.RATE_LIMIT_CHAT_PER_MINUTE = '200';

  const { createApp } = await import('../src/app.js');
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  globalThis.__stiHomeUrl = `http://127.0.0.1:${port}/`;
  globalThis.__stiTestUrl = `${globalThis.__stiHomeUrl}chat/`;

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
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

test('the homepage introduces the assistant before opening chat', { skip }, async () => {
  await navigate(globalThis.__stiHomeUrl);
  const home = await evaluate(`({
    heading: document.querySelector('h1').innerText,
    chat: document.getElementById('startChatLink').getAttribute('href'),
    composer: Boolean(document.getElementById('composer')),
    topics: document.querySelectorAll('.home-topic').length,
    stored: localStorage.getItem('sti-terms-accepted'),
    apiCalls: performance.getEntriesByType('resource').filter(r => new URL(r.name).pathname.startsWith('/api/')).length,
  })`);
  assert.match(home.heading, /school day/);
  assert.equal(home.chat, '/chat/');
  assert.equal(home.composer, false);
  assert.equal(home.topics, 4);
  assert.equal(home.stored, null);
  assert.equal(home.apiCalls, 0, 'the landing page does not initialize the chatbot');
  await evaluate(`document.getElementById('startChatLink').click()`);
  await waitFor(`location.pathname === '/chat/' && Boolean(document.getElementById('termsAgreeCheck'))`);
});

test('the first visit is gated by the terms of use', { skip }, async () => {
  await navigate(globalThis.__stiTestUrl, { acceptTerms: false });

  const gate = await evaluate(`({
    open: !document.getElementById('modalBackdrop').hidden,
    title: document.getElementById('modalTitle').textContent,
    closeHidden: document.getElementById('modalClose').hidden,
    agreeDisabled: document.getElementById('termsAgreeBtn').disabled,
    stored: localStorage.getItem('sti-terms-accepted'),
    inert: document.getElementById('appShell').inert,
  })`);
  assert.equal(gate.open, true, 'the gate must open on a first visit');
  assert.match(gate.title, /Terms of use/i);
  assert.equal(gate.closeHidden, true, 'a locked gate has no close button');
  assert.equal(gate.agreeDisabled, true, 'agree stays disabled until the checkbox is ticked');
  assert.equal(gate.stored, null, 'nothing is stored before acceptance');
  assert.equal(gate.inert, true, 'background chat controls are inaccessible before acceptance');

  // The chat is blocked while the gate is open: submitting does nothing.
  await evaluate(`(() => {
    const input = document.getElementById('messageInput');
    input.value = 'What should I do if I forget my school ID?';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();
    return true;
  })()`);
  await sleep(400);
  const blocked = await evaluate(`({
    messages: document.querySelectorAll('.message').length,
    gateStillOpen: !document.getElementById('modalBackdrop').hidden,
  })`);
  assert.equal(blocked.messages, 0, 'no question may be sent before accepting');
  assert.equal(blocked.gateStillOpen, true);

  // Escape, backdrop clicks, and Ctrl+K must not dismiss or bypass the gate.
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await evaluate(`document.getElementById('modalBackdrop').click()`);
  await evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`
  );
  const afterEscapes = await evaluate(`({
    gateOpen: !document.getElementById('modalBackdrop').hidden,
    paletteHidden: document.getElementById('paletteBackdrop').hidden,
  })`);
  assert.equal(afterEscapes.gateOpen, true);
  assert.equal(afterEscapes.paletteHidden, true, 'the quick-actions palette stays locked too');

  // The gate itself must not introduce horizontal overflow.
  assert.equal(
    await evaluate(`document.documentElement.scrollWidth > window.innerWidth + 1`),
    false
  );

  // Declining swaps to the declined notice, which can go back to the terms.
  await evaluate(`document.getElementById('termsDeclineBtn').click()`);
  assert.match(await evaluate(`document.getElementById('modalBody').innerText`), /not to accept/i);
  await evaluate(`document.getElementById('termsReviewBtn').click()`);
  assert.equal(await evaluate(`Boolean(document.getElementById('termsAgreeCheck'))`), true);

  // Ticking the checkbox enables agreement, and accepting lets the chat work.
  await evaluate(`(() => {
    const checkbox = document.getElementById('termsAgreeCheck');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(
    await evaluate(`document.getElementById('termsAgreeBtn').disabled`),
    false,
    'agree enables once the checkbox is ticked'
  );
  await evaluate(`document.getElementById('termsAgreeBtn').click()`);
  await waitFor('document.getElementById("modalBackdrop").hidden', 4000, 'gate closes after accepting');

  const stored = await evaluate(`JSON.parse(localStorage.getItem('sti-terms-accepted'))`);
  assert.equal(stored.version, '1');
  assert.equal(await evaluate(`document.getElementById('appShell').inert`), false);

  // Acceptance persists across reloads: the gate does not come back.
  await navigate(globalThis.__stiTestUrl, { acceptTerms: false });
  assert.equal(await evaluate(`document.getElementById('modalBackdrop').hidden`), true);
});

test('topic links preserve the terms gate and prepare an editable draft', { skip }, async () => {
  // A previous terms version must require a new acceptance, including deep links.
  await evaluate(`localStorage.setItem('sti-terms-accepted', JSON.stringify({ version: 'old' }))`);
  await navigate(`${globalThis.__stiTestUrl}?topic=id`, { acceptTerms: false });
  assert.equal(await evaluate(`document.getElementById('messageInput').value`), '');
  assert.equal(await evaluate(`document.getElementById('modalBackdrop').hidden`), false);
  await evaluate(`document.getElementById('termsDeclineBtn').click()`);
  await evaluate(`document.querySelector('#modalBody a[href="/"]').click()`);
  await waitFor(`location.pathname === '/' && Boolean(document.getElementById('homeMain'))`);
  await evaluate(`document.querySelector('.home-topic[href="/chat/?topic=id"]').click()`);
  await waitFor(`location.pathname === '/chat/' && Boolean(document.getElementById('termsAgreeCheck'))`);
  await acceptTermsIfShown();
  assert.equal(
    await evaluate(`document.getElementById('messageInput').value`),
    'What should I do if I forget my school ID?'
  );
  assert.equal(await evaluate(`document.querySelectorAll('.message').length`), 0, 'a topic is not automatically sent');
  assert.equal(await evaluate(`document.getElementById('sendBtn').disabled`), false);
  assert.equal(await evaluate(`location.search`), '', 'the consumed topic is removed from the URL');
  await evaluate(`document.querySelector('.home-link').click()`);
  await waitFor(`location.pathname === '/' && Boolean(document.getElementById('homeMain'))`);
  await evaluate(`document.getElementById('startChatLink').click()`);
  await waitFor(`location.pathname === '/chat/' && Boolean(document.getElementById('appShell')) && !document.getElementById('appShell').inert`);
  assert.equal(await evaluate(`document.getElementById('modalBackdrop').hidden`), true);
  await navigate(`${globalThis.__stiTestUrl}?topic=unrecognized`);
  assert.equal(await evaluate(`document.getElementById('messageInput').value`), '');
  await navigate(`${globalThis.__stiTestUrl}?panel=terms`);
  assert.match(await evaluate(`document.getElementById('modalTitle').textContent`), /Terms of use/);
  await evaluate(`document.getElementById('modalClose').click()`);
  assert.equal(await evaluate(`document.getElementById('appShell').inert`), false);
});

test('the homepage supports mobile, shared themes, FAQs, and JavaScript-free navigation', { skip }, async () => {
  await navigate(globalThis.__stiHomeUrl);
  for (const width of [1440, 768, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
    assert.equal(await evaluate(`document.documentElement.scrollWidth > window.innerWidth + 1`), false, `no overflow at ${width}px`);
    assert.equal(await evaluate(`(() => {
      const rect = document.getElementById('startChatLink').getBoundingClientRect();
      return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth;
    })()`), true, `the main action fits at ${width}px`);
  }
  await evaluate(`document.getElementById('homeThemeBtn').click()`);
  const theme = await evaluate(`localStorage.getItem('sti-theme')`);
  assert.ok(['dark', 'light'].includes(theme));
  await navigate(globalThis.__stiTestUrl);
  assert.equal(await evaluate(`document.documentElement.getAttribute('data-theme') || 'light'`), theme);
  await navigate(`${globalThis.__stiHomeUrl}#privacy`);
  assert.equal(await evaluate(`document.getElementById('privacy').open`), true);
  await evaluate('window.__stiLeaving = true');
  await send('Emulation.setScriptExecutionDisabled', { value: true });
  try {
    const result = await send('Page.navigate', { url: globalThis.__stiHomeUrl });
    assert.ok(result.result.frameId);
    await waitFor(`window.__stiLeaving !== true && document.readyState === 'complete' && Boolean(document.getElementById('startChatLink'))`);
    // CDP evaluation is still available while page scripts are disabled.
    assert.equal(await evaluate(`document.getElementById('startChatLink').getAttribute('href')`), '/chat/');
    assert.equal(await evaluate(`document.getElementById('homeThemeBtn').hidden`), true);
  } finally {
    await send('Emulation.setScriptExecutionDisabled', { value: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await evaluate(`localStorage.setItem('sti-theme', 'light')`);
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

test('more topics expands and collapses without sending a question', { skip }, async () => {
  const visibleCards = 'document.querySelectorAll("#startCards .start-card:not([hidden])").length';
  assert.equal(await evaluate(visibleCards), 4);
  const total = await evaluate('document.querySelectorAll("#startCards .start-card").length');
  await evaluate('document.getElementById("topicsToggle").click()');
  assert.equal(await evaluate(visibleCards), total);
  assert.equal(await evaluate('document.getElementById("topicsToggle").getAttribute("aria-expanded")'), 'true');
  assert.equal(await evaluate('document.getElementById("messageList").childElementCount'), 0);
  await evaluate('document.getElementById("topicsToggle").click()');
  assert.equal(await evaluate(visibleCards), 4);
  assert.equal(await evaluate('document.getElementById("topicsToggle").getAttribute("aria-expanded")'), 'false');
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

test('offline navigation keeps the homepage and chat shells separate', { skip }, async () => {
  await navigate(globalThis.__stiHomeUrl);
  await evaluate('navigator.serviceWorker.ready');
  await waitFor('Boolean(navigator.serviceWorker.controller)');
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  try {
    await navigate(globalThis.__stiHomeUrl);
    assert.equal(await evaluate(`Boolean(document.getElementById('homeMain'))`), true);
    // This URL was never visited online: the service worker must choose the
    // cached chat shell, not its old unconditional homepage fallback.
    await navigate(`${globalThis.__stiTestUrl}?topic=uniform&offline-check=1`);
    assert.equal(await evaluate(`document.getElementById('messageInput').value`), 'What are the uniform requirements?');
    assert.equal(await evaluate(`Boolean(document.getElementById('homeMain'))`), false);
    await waitFor(`document.getElementById('headerMode').classList.contains('is-offline')`);
  } finally {
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
});
