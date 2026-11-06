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

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.home-header');
  const nav = document.getElementById('homeNav');
  const navLinks = [...nav.querySelectorAll('a')];
  const sections = navLinks.map((link) => document.querySelector(link.hash));
  const backTop = document.getElementById('homeBackTop');
  let scrollFrame = 0;
  let headerHeight = header.offsetHeight;
  let currentSection = null;

  // Native anchor scrolling retains keyboard focus, URL history, touch and
  // wheel behavior. Only the small navigation indicators need a scroll handler.
  function updateNavigation() {
    scrollFrame = 0;
    header.classList.toggle('is-scrolled', window.scrollY > 12);
    backTop.classList.toggle('is-visible', window.scrollY > 650);
    const readingLine = headerHeight + Math.min(140, window.innerHeight * 0.2);
    let active = -1;
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= readingLine) active = index;
    });
    // The final section can be too short to reach the reading line.
    if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) active = sections.length - 1;
    if (active !== currentSection) {
      currentSection = active;
      navLinks.forEach((link, index) => {
        if (index === active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      nav.classList.toggle('has-active', active >= 0);
      if (active >= 0) {
        nav.style.setProperty('--nav-active-x', `${navLinks[active].offsetLeft}px`);
        nav.style.setProperty('--nav-active-width', `${navLinks[active].offsetWidth}px`);
      }
    }
  }

  function queueNavigationUpdate() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateNavigation);
  }

  function measureHeader() {
    headerHeight = header.offsetHeight;
    currentSection = null;
    document.documentElement.style.setProperty('--home-header-offset', `${headerHeight + 16}px`);
    queueNavigationUpdate();
  }

  backTop.hidden = false;
  window.addEventListener('scroll', queueNavigationUpdate, { passive: true });
  window.addEventListener('resize', measureHeader, { passive: true });
  window.addEventListener('pageshow', measureHeader);
  if ('ResizeObserver' in window) new ResizeObserver(measureHeader).observe(header);
  measureHeader();

  // Only prepare off-screen elements, so the first screen paints immediately.
  // Reveals happen once; keyboard focus and reduced motion always show content.
  const revealItems = [...document.querySelectorAll('.home-section-heading, .home-topic, .home-how-intro, .home-steps li, .home-faq-intro, .home-faq-list, .home-final-cta')];
  let revealObserver = null;
  function reveal(element) {
    element.classList.remove('is-reveal-pending');
    revealObserver?.unobserve(element);
  }
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) reveal(entry.target); });
    }, { threshold: 0.08 });
    revealItems.forEach((element) => {
      if (element.getBoundingClientRect().top < window.innerHeight) return;
      element.classList.add('home-reveal', 'is-reveal-pending');
      revealObserver.observe(element);
    });
    document.addEventListener('focusin', (event) => {
      const element = event.target.closest('.is-reveal-pending');
      if (element) reveal(element);
    });
  }
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    revealObserver?.disconnect();
    revealItems.forEach(reveal);
  });

  function revealLinkedDetail() {
    if (window.location.hash === '#privacy') document.getElementById('privacy').open = true;
  }
  // Also handles clicking Privacy again after its disclosure was closed while
  // the URL already contained #privacy (which does not emit hashchange).
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest('a[href="#privacy"]')) document.getElementById('privacy').open = true;
  });
  window.addEventListener('hashchange', revealLinkedDetail);
  revealLinkedDetail();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* Offline shell is optional. */ });
    });
  }
})();
