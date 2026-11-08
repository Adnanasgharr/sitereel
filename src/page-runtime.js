'use strict';
// Code that runs INSIDE the recorded web page.

/**
 * Injected before any of the site's own scripts. Replaces the page's clock with a virtual one,
 * so every animation advances exactly one frame at a time and nothing can stutter or drop.
 * Covers: requestAnimationFrame (GSAP, Lenis, Framer Motion, ScrollTrigger…), performance.now,
 * Date.now, CSS transitions/animations + Web Animations, and <video> playback.
 */
function installVirtualTime() {
  if (window.__sitereel) return;
  let vnow = 0;
  const dateBase = Date.now();
  const rafQueue = new Map(); let rafId = 0;
  performance.now = () => vnow;
  Date.now = () => dateBase + vnow;
  window.requestAnimationFrame = (cb) => { const id = ++rafId; rafQueue.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { rafQueue.delete(id); };

  // Load every image up front so nothing pops in during the shot
  try {
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const imgs = n.tagName === 'IMG' ? [n] : (n.querySelectorAll ? n.querySelectorAll('img[loading="lazy"]') : []);
        for (const i of imgs) if (i.loading === 'lazy') i.loading = 'eager';
      }
    }).observe(document, { childList: true, subtree: true });
  } catch {}

  const animStart = new WeakMap(); const videoStart = new WeakMap();
  let mode = 'native'; let nativeY = null;

  const scroller = () => {
    // Locomotive Scroll v4 style containers scroll themselves; otherwise the document scrolls
    return document.scrollingElement || document.documentElement;
  };

  window.__sitereel = {
    now: () => vnow,
    setMode(m) { mode = m; nativeY = null; },
    getMode: () => mode,

    /** Advance the virtual clock by `ms` and render everything for that moment. */
    async step(ms, scrollDelta = 0) {
      if (scrollDelta) this.scroll(scrollDelta);
      vnow += ms;
      for (const a of document.getAnimations()) {
        if (!animStart.has(a)) { const ct = Number(a.currentTime) || 0; try { a.pause(); } catch {} animStart.set(a, vnow - ms - ct); }
        try { a.currentTime = vnow - animStart.get(a); } catch {}
      }
      const cbs = [...rafQueue.values()]; rafQueue.clear();
      for (const cb of cbs) { try { cb(vnow); } catch (e) { console.error(e); } }
      const seeks = [];
      for (const v of document.querySelectorAll('video')) {
        try { if (!v.paused) v.pause(); } catch {}
        if (!(v.duration > 0) || !isFinite(v.duration)) continue;
        if (!videoStart.has(v)) videoStart.set(v, vnow - ms - (v.currentTime || 0) * 1000);
        const t = ((vnow - videoStart.get(v)) / 1000) % v.duration;
        seeks.push(new Promise((resolve) => {
          const done = () => { v.removeEventListener('seeked', done); resolve(); };
          v.addEventListener('seeked', done); v.currentTime = t; setTimeout(resolve, 400);
        }));
      }
      await Promise.all(seeks);
      // Where the visible area is, in page coordinates (needed to capture the right region)
      const vv = window.visualViewport;
      return { x: vv ? vv.pageLeft : window.scrollX, y: vv ? vv.pageTop : window.scrollY };
    },

    /** Scroll by `dy` pixels, the way the site expects (wheel for smooth-scroll libraries). */
    scroll(dy) {
      if (mode === 'wheel') {
        document.documentElement.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true }));
      } else {
        const el = scroller();
        if (nativeY == null) nativeY = el.scrollTop;
        nativeY = Math.max(0, Math.min(nativeY + dy, this.maxScroll()));
        el.scrollTop = Math.round(nativeY);
        window.dispatchEvent(new Event('scroll'));
      }
    },

    scrollY() { return mode === 'native' && nativeY != null ? nativeY : (window.scrollY || scroller().scrollTop || 0); },
    maxScroll() {
      const docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      const c = document.querySelector('[data-scroll-container]');
      return Math.max(0, Math.max(docH, c ? c.scrollHeight : 0) - window.innerHeight);
    },
    /** Absolute top (page coordinates) of the first element matching `sel`, or null. */
    top(sel) {
      const e = document.querySelector(sel);
      return e ? e.getBoundingClientRect().top + (window.scrollY || scroller().scrollTop || 0) : null;
    },
    center(sel) {
      const e = document.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    click(sel) { const e = document.querySelector(sel); if (!e) return false; e.click(); return true; },
    focus(sel) { const e = document.querySelector(sel); if (!e) return false; e.focus(); return true; },
  };
}

/** Is this a smooth-scroll site (Lenis, Locomotive, etc.) that should be scrolled with wheel events? */
function detectScrollMode() {
  const html = document.documentElement;
  const cls = html.className + ' ' + (document.body ? document.body.className : '');
  if (/\blenis\b|has-scroll-smooth|has-scroll-init|locomotive/i.test(cls)) return 'wheel';
  if (document.querySelector('[data-scroll-container],[data-lenis-prevent],.lenis,[data-scroll-section]')) return 'wheel';
  if (window.lenis || window.Lenis || window.locomotiveScroll || window.LocomotiveScroll || window.__lenis) return 'wheel';
  return 'native';
}

/** Wait (in real time) for fonts, all images and videos to be ready before recording. */
async function waitForAssets(timeoutMs) {
  const deadline = new Promise((r) => setTimeout(r, timeoutMs));
  const ready = (async () => {
    try { await document.fonts.ready; } catch {}
    for (const i of document.querySelectorAll('img[loading="lazy"]')) i.loading = 'eager';
    await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))));
    await Promise.all([...document.querySelectorAll('video')].map((v) => (v.readyState >= 2 ? 0 : new Promise((r) => { v.addEventListener('loadeddata', r, { once: true }); v.addEventListener('error', r, { once: true }); }))));
  })();
  await Promise.race([ready, deadline]);
}

/**
 * Find good places to pause while scrolling: section starts and headings.
 * Returns absolute scroll positions, spaced at least ~60% of a screen apart.
 */
function findSections() {
  const vh = window.innerHeight;
  const sy = window.scrollY || 0;
  const max = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - vh;
  const visible = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.height > 0 && r.width > 0; };
  const cands = [];
  for (const e of document.querySelectorAll('main section, body > section, section[id], [class*="section" i], article > section')) {
    if (!visible(e)) continue; const r = e.getBoundingClientRect();
    if (r.height > vh * 0.4) cands.push(r.top + sy - 40);
  }
  for (const e of document.querySelectorAll('h1, h2')) {
    if (!visible(e)) continue; const r = e.getBoundingClientRect();
    cands.push(r.top + sy - vh * 0.18);
  }
  const sorted = cands.map((y) => Math.round(Math.max(0, Math.min(y, max)))).filter((y) => y > vh * 0.5 && y < max - vh * 0.3).sort((a, b) => a - b);
  const out = [];
  for (const y of sorted) if (!out.length || y - out[out.length - 1] > vh * 0.6) out.push(y);
  // No recognisable sections (e.g. sites built from plain <div>s): pause at a steady rhythm instead
  if (!out.length && max > vh * 2) {
    for (let y = vh * 1.6; y < max - vh * 0.5; y += vh * 1.6) out.push(Math.round(y));
  }
  return out.slice(0, 20);
}

/** CSS that hides common cookie banners, chat widgets and newsletter pop-ups. */
const COMMON_POPUPS = [
  '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#cookie-law-info-bar', '.cc-window', '.cc-banner',
  '#cookie-notice', '#cookieConsent', '.cookie-consent', '.cookie-banner', '.cookiebanner', '#cookiebanner', '[aria-label*="cookie" i][role="dialog"]',
  '.fs-cc-banner2_component', '.fs-cc-prefs_component', '#usercentrics-root', '#didomi-host', '.qc-cmp2-container', '#truste-consent-track',
  '#hubspot-messages-iframe-container', '#intercom-container', '.intercom-lightweight-app', '#crisp-chatbox', '.crisp-client', '#tidio-chat',
  '#drift-widget', '#drift-frame-controller', '.tawk-min-container', 'iframe[title*="chat" i]', '.zEWidget-launcher',
];

module.exports = { installVirtualTime, detectScrollMode, waitForAssets, findSections, COMMON_POPUPS };
