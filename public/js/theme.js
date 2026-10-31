/* ==========================================================================
   STI Assist AI — theme bootstrap
   Runs synchronously in <head>, before the first paint, so a saved dark
   theme never flashes light. The full client (app.js) takes over later.
   ========================================================================== */

(function () {
  'use strict';

  try {
    var choice = window.localStorage.getItem('sti-theme');
    var dark =
      choice === 'dark' ||
      (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (!dark) return;

    document.documentElement.setAttribute('data-theme', 'dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#0a1120');
  } catch (error) {
    /* Storage can be blocked; the default light theme still works. */
  }
})();
