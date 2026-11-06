/* Progressive enhancement: the landing page and all chat links work without JS. */
(() => {
  'use strict';

  const button = document.getElementById('homeThemeBtn');
  const icon = document.getElementById('homeThemeIcon');
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let choice = 'system';
  try {
    const saved = localStorage.getItem('sti-theme');
    if (['light', 'dark', 'system'].includes(saved)) choice = saved;
  } catch { /* Theme still works for this page when storage is blocked. */ }

  function applyTheme() {
    const dark = choice === 'dark' || (choice === 'system' && media.matches);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    icon.setAttribute('href', dark ? '#h-sun' : '#h-moon');
    button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0a1120' : '#0b1c3d');
  }

  button.hidden = false;
  button.addEventListener('click', () => {
    choice = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('sti-theme', choice); } catch { /* Optional persistence. */ }
    applyTheme();
  });
  media.addEventListener('change', applyTheme);
  window.addEventListener('storage', (event) => {
    if (event.key !== 'sti-theme' && event.key !== null) return;
    choice = ['light', 'dark'].includes(event.newValue) ? event.newValue : 'system';
    applyTheme();
  });
  applyTheme();

  function revealLinkedDetail() {
    if (window.location.hash === '#privacy') document.getElementById('privacy').open = true;
  }
  window.addEventListener('hashchange', revealLinkedDetail);
  revealLinkedDetail();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* Offline shell is optional. */ });
    });
  }
})();
