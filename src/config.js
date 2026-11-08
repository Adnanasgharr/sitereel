'use strict';
// Settings: defaults, presets, loading a config file and merging command-line flags.

const fs = require('fs');
const path = require('path');

/** Formats: the browser viewport (CSS pixels) and the scale that turns it into the 1080p output. */
const FORMATS = {
  '16:9': { width: 1920, height: 1080, scale: 1 },   // → 1920×1080 (YouTube, email, website)
  '9:16': { width: 432, height: 768, scale: 2.5 },   // → 1080×1920 (Reels, TikTok, Shorts) — phone layout
  '1:1': { width: 1080, height: 1080, scale: 1 },    // → 1080×1080 (feed posts)
  '4:5': { width: 1080, height: 1350, scale: 1 },    // → 1080×1350 (tall feed posts)
};

/** Scroll speed presets, in viewport-heights per second (so they feel the same in every format). */
const SPEEDS = { slow: 0.25, medium: 0.35, fast: 0.5 };

const DEFAULTS = {
  url: null,
  pages: null,          // null = just the address you gave
  format: '16:9',
  width: null,          // custom format: viewport width (CSS px)
  height: null,         // custom format: viewport height (CSS px)
  quality: '1080p',     // 1080p | 4k
  fps: 60,              // 30 | 60
  speed: 'medium',      // slow | medium | fast | number (px per second)
  transition: { type: 'crossfade', duration: 0.8 }, // crossfade | cut
  startHold: 2.5,       // seconds to wait at the top of each page (lets intro animations play)
  endHold: 1.5,         // seconds to hold at the end of each page
  pause: 0.9,           // seconds to pause at each section
  autoPauses: true,     // find sections/headings automatically and pause on them
  fullPage: true,       // scroll to the very bottom of each page (when no custom actions)
  hide: [],             // CSS selectors to hide (cookie banners, chat widgets…)
  hideCommonPopups: true,
  css: '',              // extra CSS injected into every page
  mobile: null,         // emulate a phone (touch + mobile user agent). Default: on for 9:16
  scrollMode: 'auto',   // auto | wheel (smooth-scroll sites) | native
  browser: 'auto',      // auto | chrome | msedge | chromium
  headed: false,        // show the browser window while recording
  auth: {},             // { cookies, storageState, localStorage, login }
  out: null,            // output .mp4 path
  draft: false,         // fast low-res preview
  jpegQuality: 92,
  keepFrames: false,
  timeout: 90,          // seconds to wait for a page to load
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${file}: ${e.message}`);
  }
}

/** "$ENV:NAME" in any string value is replaced by the environment variable NAME (for passwords). */
function substituteEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$ENV:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
      if (process.env[name] == null) throw new Error(`Environment variable ${name} is not set (used as $ENV:${name}).`);
      return process.env[name];
    });
  }
  if (Array.isArray(value)) return value.map(substituteEnv);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteEnv(v)]));
  }
  return value;
}

/** Turn "/" , "/about" or full URLs into page objects. */
function normalisePages(pages) {
  return (pages || []).map((p) => (typeof p === 'string' ? { path: p } : { ...p }));
}

/**
 * Build the final settings from: defaults ← config file ← command-line flags.
 * Paths inside a config file (cookies, css files, out) are resolved relative to that file.
 */
function buildConfig(flags) {
  let cfg = { ...DEFAULTS };
  let baseDir = process.cwd();

  if (flags.config) {
    const file = path.resolve(flags.config);
    baseDir = path.dirname(file);
    cfg = { ...cfg, ...readJson(file) };
  }

  const set = (key, value) => { if (value !== undefined && value !== null) cfg[key] = value; };
  set('url', flags.url);
  if (flags.pages) cfg.pages = flags.pages.split(',').map((s) => s.trim()).filter(Boolean);
  set('format', flags.format);
  set('quality', flags.quality);
  if (flags.fps) cfg.fps = Number(flags.fps);
  if (flags.speed) cfg.speed = isNaN(Number(flags.speed)) ? flags.speed : Number(flags.speed);
  if (flags.width) cfg.width = Number(flags.width);
  if (flags.height) cfg.height = Number(flags.height);
  if (flags.transition) cfg.transition = { ...asTransition(cfg.transition), type: flags.transition };
  if (flags.crossfade) cfg.transition = { type: 'crossfade', duration: Number(flags.crossfade) };
  if (flags.hide && flags.hide.length) cfg.hide = [...(cfg.hide || []), ...flags.hide];
  if (flags.css) cfg.css = flags.css;
  if (flags.cookies) cfg.auth = { ...cfg.auth, cookies: flags.cookies };
  if (flags['storage-state']) cfg.auth = { ...cfg.auth, storageState: flags['storage-state'] };
  set('out', flags.out);
  if (flags.draft) cfg.draft = true;
  if (flags.headed) cfg.headed = true;
  set('browser', flags.browser);
  if (flags.mobile) cfg.mobile = true;
  if (flags.pause) cfg.pause = Number(flags.pause);
  if (flags['no-auto-pauses']) cfg.autoPauses = false;
  if (flags['start-hold']) cfg.startHold = Number(flags['start-hold']);
  if (flags['end-hold']) cfg.endHold = Number(flags['end-hold']);
  if (flags['keep-frames']) cfg.keepFrames = true;
  set('scrollMode', flags['scroll-mode']);

  cfg = substituteEnv(cfg);
  // No pages listed → record exactly the address given (e.g. https://site.com/about)
  cfg.pages = cfg.pages && cfg.pages.length ? normalisePages(cfg.pages) : [{ path: null }];
  cfg.transition = asTransition(cfg.transition);
  cfg.baseDir = baseDir;
  return finalise(cfg);
}

function asTransition(t) {
  if (!t) return { type: 'cut', duration: 0 };
  if (typeof t === 'string') return { type: t, duration: t === 'crossfade' ? 0.8 : 0 };
  return { type: t.type || 'crossfade', duration: t.duration ?? 0.8 };
}

/** Validate and compute derived values (viewport, scale, output size, speed in px/s…). */
function finalise(cfg) {
  const errors = [];
  if (!cfg.url && !cfg.pages.some((p) => p.url)) errors.push('Give a website address, e.g. `sitereel https://example.com`, or "url" in your config file.');
  if (cfg.url && !/^https?:\/\//i.test(cfg.url)) cfg.url = 'https://' + cfg.url;

  // Viewport & scale
  let fmt;
  if (cfg.format === 'custom' || (cfg.width && cfg.height)) {
    if (!cfg.width || !cfg.height) errors.push('A custom format needs both "width" and "height" (viewport size in CSS pixels).');
    fmt = { width: cfg.width, height: cfg.height, scale: cfg.scale || 1 };
    cfg.format = 'custom';
  } else {
    fmt = FORMATS[cfg.format];
    if (!fmt) errors.push(`Unknown format "${cfg.format}". Use one of: ${Object.keys(FORMATS).join(', ')}, or set "width" and "height".`);
  }
  if (!['1080p', '4k'].includes(String(cfg.quality).toLowerCase())) errors.push('quality must be "1080p" or "4k".');
  cfg.quality = String(cfg.quality).toLowerCase();
  if (![24, 25, 30, 50, 60].includes(cfg.fps)) errors.push('fps must be 24, 25, 30, 50 or 60.');
  if (!['crossfade', 'cut'].includes(cfg.transition.type)) errors.push('transition must be "crossfade" or "cut".');
  if (!['auto', 'wheel', 'native'].includes(cfg.scrollMode)) errors.push('scrollMode must be "auto", "wheel" or "native".');
  if (typeof cfg.speed === 'string' && !SPEEDS[cfg.speed]) errors.push(`speed must be ${Object.keys(SPEEDS).join(', ')} or a number (pixels per second).`);
  if (errors.length) throw new Error(errors.join('\n'));

  let scale = fmt.scale;
  if (cfg.quality === '4k') scale *= 2;
  if (cfg.draft) { scale *= 0.5; cfg.fps = 15; cfg.jpegQuality = 70; }
  cfg.viewport = { width: fmt.width, height: fmt.height };
  cfg.scale = scale;
  cfg.output = { width: even(fmt.width * scale), height: even(fmt.height * scale) };
  cfg.pxPerSecond = typeof cfg.speed === 'number' ? cfg.speed : SPEEDS[cfg.speed] * fmt.height;
  if (cfg.mobile == null) cfg.mobile = cfg.format === '9:16';

  if (!cfg.out) {
    const host = cfg.url ? new URL(cfg.url).hostname.replace(/^www\./, '') : 'site';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    cfg.out = `sitereel-${host}-${cfg.format.replace(':', 'x')}${cfg.draft ? '-draft' : ''}-${stamp}.mp4`;
  }
  cfg.out = path.resolve(cfg.baseDir, cfg.out);

  // Resolve page URLs
  cfg.pages = cfg.pages.map((p) => ({ ...p, href: p.url || (p.path == null ? new URL(cfg.url).href : new URL(p.path, cfg.url).href) }));
  return cfg;
}

function even(n) { return Math.max(2, Math.round(n / 2) * 2); }

module.exports = { buildConfig, FORMATS, SPEEDS, DEFAULTS };
