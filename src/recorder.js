'use strict';
// Drives the browser: login/cookies, loading each page, running the shot plan and capturing frames.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { installVirtualTime, detectScrollMode, waitForAssets, findSections, COMMON_POPUPS } = require('./page-runtime');
const log = require('./log');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// ───────────────────────────── browser ─────────────────────────────

async function launchBrowser(cfg) {
  const order = cfg.browser === 'auto' ? ['chrome', 'msedge', 'chromium'] : [cfg.browser];
  const args = ['--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate'];
  for (const channel of order) {
    try {
      const browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: !cfg.headed, args });
      if (channel === 'chromium') log.warn('Using the built-in Chromium: it cannot play MP4 (H.264) videos, so background videos may appear frozen. Install Google Chrome for best results.');
      log.info(`Browser: ${channel} ${browser.version()}`);
      return browser;
    } catch (e) {
      if (cfg.browser !== 'auto') throw new Error(`Could not start ${channel}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error('No browser found. Install Google Chrome, or run: npx playwright install chromium');
}

// ───────────────────────────── login / cookies ─────────────────────────────

/** Accepts Playwright cookies or cookie-export-extension JSON (expirationDate, hostOnly…). */
function normaliseCookies(list, fallbackUrl) {
  return list.map((c) => {
    const out = { name: c.name, value: String(c.value ?? ''), path: c.path || '/' };
    if (c.domain) out.domain = c.domain; else out.url = fallbackUrl;
    const exp = c.expires ?? c.expirationDate;
    if (exp && exp > 0) out.expires = Math.round(exp);
    if (c.httpOnly != null) out.httpOnly = !!c.httpOnly;
    if (c.secure != null) out.secure = !!c.secure;
    const ss = String(c.sameSite || '').toLowerCase();
    if (ss === 'lax') out.sameSite = 'Lax'; else if (ss === 'strict') out.sameSite = 'Strict'; else if (ss === 'none' || ss === 'no_restriction') out.sameSite = 'None';
    return out;
  });
}

function loadJsonOrValue(value, baseDir) {
  if (typeof value === 'string') return JSON.parse(fs.readFileSync(path.resolve(baseDir, value), 'utf8'));
  return value;
}

/** Runs the optional login steps in a normal (real-time) browser and returns the resulting session. */
async function runLogin(browser, cfg, contextOptions) {
  const login = cfg.auth.login;
  log.step(`Logging in at ${login.url}`);
  const ctx = await browser.newContext(contextOptions);
  const page = await ctx.newPage();
  await page.goto(login.url, { waitUntil: 'load', timeout: cfg.timeout * 1000 });
  for (const s of login.steps || []) {
    if (s.fill) await page.fill(s.fill, String(s.value ?? ''));
    else if (s.click) await page.click(s.click);
    else if (s.press) await page.keyboard.press(s.press);
    else if (s.waitFor) await page.waitForSelector(s.waitFor, { timeout: 30000 });
    else if (s.waitForUrl) await page.waitForURL(s.waitForUrl, { timeout: 30000 });
    else if (s.wait) await page.waitForTimeout(Number(s.wait) * 1000);
    else if (s.goto) await page.goto(s.goto, { waitUntil: 'load' });
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  const state = await ctx.storageState();
  await ctx.close();
  log.ok('Logged in');
  return state;
}

async function createContext(browser, cfg) {
  const contextOptions = {
    viewport: cfg.viewport,
    deviceScaleFactor: cfg.scale,
    isMobile: !!cfg.mobile,
    hasTouch: !!cfg.mobile,
    ...(cfg.mobile ? { userAgent: MOBILE_UA } : {}),
    reducedMotion: 'no-preference',
    colorScheme: 'light',
  };
  if (cfg.auth.storageState) contextOptions.storageState = path.resolve(cfg.baseDir, cfg.auth.storageState);
  if (cfg.auth.login) contextOptions.storageState = await runLogin(browser, cfg, contextOptions);

  const ctx = await browser.newContext(contextOptions);
  if (cfg.auth.cookies) {
    const list = loadJsonOrValue(cfg.auth.cookies, cfg.baseDir);
    await ctx.addCookies(normaliseCookies(Array.isArray(list) ? list : list.cookies || [], cfg.url || cfg.pages[0].href));
  }
  if (cfg.auth.localStorage) {
    await ctx.addInitScript((items) => { try { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {} }, cfg.auth.localStorage);
  }
  await ctx.addInitScript(installVirtualTime);
  return ctx;
}

// ───────────────────────────── one page ─────────────────────────────

const BLOCKED = /security checkpoint|just a moment|attention required|access denied|verify you are human|are you a robot/i;

async function preparePage(page, cfg, pageCfg) {
  const hide = [...(cfg.hideCommonPopups ? COMMON_POPUPS : []), ...(cfg.hide || []), ...(pageCfg.hide || [])];
  let css = 'html{scroll-behavior:auto!important}::-webkit-scrollbar{display:none!important}html{scrollbar-width:none!important}';
  if (hide.length) css += `${hide.join(',')}{display:none!important;visibility:hidden!important}`;
  for (const extra of [cfg.css, pageCfg.css]) {
    if (!extra) continue;
    const file = path.resolve(cfg.baseDir, extra);
    css += /\.css$/i.test(extra) && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : extra;
  }
  await page.addStyleTag({ content: css }).catch(() => {});
  // Some frameworks (React/Next.js streaming, lazy sections) finish rendering inside an animation
  // frame. Run a few frames at zero elapsed time so the page is complete, without starting animations.
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.__sitereel.step(0)).catch(() => {});
      await page.waitForTimeout(60);
    }
  };
  await settle();
  await page.evaluate(waitForAssets, 30000).catch(() => {});
  await settle();
  await page.waitForTimeout(300);
  const mode = cfg.scrollMode === 'auto' ? await page.evaluate(detectScrollMode) : cfg.scrollMode;
  await page.evaluate((m) => window.__sitereel.setMode(m), mode);
  return mode;
}

/** Turn the page settings into a list of actions. */
async function buildPlan(page, cfg, pageCfg) {
  const startHold = pageCfg.startHold ?? cfg.startHold;
  const endHold = pageCfg.endHold ?? cfg.endHold;
  const pause = pageCfg.pause ?? cfg.pause;
  const plan = [{ hold: startHold }];
  if (Array.isArray(pageCfg.actions) && pageCfg.actions.length) {
    plan.push(...pageCfg.actions);
    if (pageCfg.fullPage === true) plan.push({ scrollTo: 'bottom' });
  } else {
    let stops = [];
    if (Array.isArray(pageCfg.pauseOn) && pageCfg.pauseOn.length) {
      for (const sel of pageCfg.pauseOn) stops.push({ scrollTo: sel });
    } else if (pageCfg.autoPauses ?? cfg.autoPauses) {
      stops = (await page.evaluate(findSections)).map((y) => ({ scrollTo: y }));
    }
    for (const s of stops) plan.push(s, { hold: pause });
    if (pageCfg.fullPage ?? cfg.fullPage) plan.push({ scrollTo: 'bottom' });
  }
  plan.push({ hold: endHold });
  return plan;
}

function describe(a) {
  if (a.hold != null) return `pause ${a.hold}s`;
  if (a.scrollTo != null) return `scroll to ${typeof a.scrollTo === 'number' ? Math.round(a.scrollTo) + 'px' : a.scrollTo}`;
  if (a.scrollBy != null) return `scroll by ${a.scrollBy}px`;
  if (a.click) return `click ${a.click}`;
  if (a.hover) return `hover ${a.hover}`;
  if (a.type) return `type into ${a.type}`;
  if (a.waitFor) return `wait for ${a.waitFor}`;
  return JSON.stringify(a);
}

/**
 * Records one page into `framesDir` (f000000.jpg …). Returns the number of frames.
 */
async function recordPage(ctx, cfg, pageCfg, framesDir, label) {
  fs.mkdirSync(framesDir, { recursive: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  log.step(`${label}  ${pageCfg.href}`);
  try {
    await page.goto(pageCfg.href, { waitUntil: 'networkidle', timeout: cfg.timeout * 1000 });
  } catch (e) {
    if (!/Timeout/i.test(e.message)) throw e;
    log.warn('Page kept loading in the background (network never went quiet) — continuing.');
    await page.waitForLoadState('load').catch(() => {});
  }
  const title = await page.title().catch(() => '');
  if (BLOCKED.test(title)) log.warn(`This page looks like a bot check ("${title}"). Try --headed, supply cookies, or record a local copy of the site.`);

  let mode = await preparePage(page, cfg, pageCfg);
  log.info(`Scroll mode: ${mode}${mode === 'wheel' ? ' (smooth-scroll site)' : ''}`);

  const fps = cfg.fps; const dt = 1000 / fps;
  let frame = 0;
  // Capture straight from Chrome (faster than page.screenshot)
  const cdp = await ctx.newCDPSession(page);
  const shot = async (dy = 0) => {
    const pos = await page.evaluate(([ms, d]) => window.__sitereel.step(ms, d), [dt, dy]);
    // clip = the visible area (page coordinates) and scale = output resolution (1080p / 4K / vertical / draft)
    const clip = { x: pos.x, y: pos.y, width: cfg.viewport.width, height: cfg.viewport.height, scale: cfg.scale };
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: cfg.jpegQuality, optimizeForSpeed: true, clip });
    fs.writeFileSync(path.join(framesDir, `f${String(frame++).padStart(6, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (frame % 15 === 0) log.progress(`   ${label}: ${(frame / fps).toFixed(1)}s of video rendered (${frame} frames)`);
  };
  const speedOf = (s) => (s == null ? cfg.pxPerSecond : typeof s === 'number' ? s : { slow: 0.25, medium: 0.35, fast: 0.5 }[s] * cfg.viewport.height || cfg.pxPerSecond);

  // In wheel mode the site eases behind our input, so we track where we've *asked* it to go.
  let planned = await page.evaluate(() => window.__sitereel.scrollY());
  const current = async () => (mode === 'wheel' ? planned : page.evaluate(() => window.__sitereel.scrollY()));

  /** Natural motion: smooth (sine) acceleration, steady glide, smooth stop. */
  const glide = async (dist, speed) => {
    if (Math.abs(dist) < 1) return;
    const ramp = Math.min(0.9, 0.35 * (Math.abs(dist) / speed + 0.9));
    const T = Math.abs(dist) / speed + ramp;
    const n = Math.max(1, Math.round(T * fps));
    const vel = (t) => (t < ramp ? 0.5 - 0.5 * Math.cos(Math.PI * t / ramp) : t > T - ramp ? 0.5 - 0.5 * Math.cos(Math.PI * (T - t) / ramp) : 1);
    const w = Array.from({ length: n }, (_, i) => vel((i + 0.5) / fps));
    const sum = w.reduce((a, b) => a + b, 0);
    for (const x of w) await shot(dist * x / sum);
    planned += dist;
  };

  const afterInteraction = async () => {
    // If a click navigated to a new document, wait for it and re-arm the page.
    const before = page.url();
    await page.waitForTimeout(250);
    if (page.url() !== before) {
      await page.waitForLoadState('load').catch(() => {});
      mode = await preparePage(page, cfg, pageCfg);
      planned = await page.evaluate(() => window.__sitereel.scrollY());
    }
  };

  const plan = await buildPlan(page, cfg, pageCfg);
  for (const a of plan) {
    log.detail(describe(a));
    if (a.hold != null) {
      for (let i = 0; i < Math.round(Number(a.hold) * fps); i++) await shot();
    } else if (a.scrollTo != null) {
      const max = await page.evaluate(() => window.__sitereel.maxScroll());
      let target;
      if (typeof a.scrollTo === 'number') target = a.scrollTo;
      else if (a.scrollTo === 'bottom') target = max;
      else if (a.scrollTo === 'top') target = 0;
      else {
        target = await page.evaluate((s) => window.__sitereel.top(s), a.scrollTo);
        if (target == null) { log.warn(`Not found on page: ${a.scrollTo} — skipped`); continue; }
      }
      target = Math.max(0, Math.min(max, target - (a.offset || 0)));
      await glide(target - (await current()), speedOf(a.speed));
    } else if (a.scrollBy != null) {
      const max = await page.evaluate(() => window.__sitereel.maxScroll());
      const from = await current();
      await glide(Math.max(0, Math.min(max, from + Number(a.scrollBy))) - from, speedOf(a.speed));
    } else if (a.click) {
      const ok = await page.evaluate((s) => window.__sitereel.click(s), a.click);
      if (!ok) log.warn(`Not found on page: ${a.click} — click skipped`);
      await afterInteraction();
      await shot();
    } else if (a.hover) {
      const c = await page.evaluate((s) => window.__sitereel.center(s), a.hover);
      if (!c) { log.warn(`Not found on page: ${a.hover} — hover skipped`); continue; }
      await page.mouse.move(c.x, c.y);
      await shot();
    } else if (a.type) {
      const ok = await page.evaluate((s) => window.__sitereel.focus(s), a.type);
      if (!ok) { log.warn(`Not found on page: ${a.type} — typing skipped`); continue; }
      const perChar = Math.max(1, Math.round(fps / (a.cps || 12)));
      for (const ch of String(a.text ?? '')) {
        await page.keyboard.type(ch);
        for (let i = 0; i < perChar; i++) await shot();
      }
    } else if (a.waitFor) {
      await page.waitForSelector(a.waitFor, { timeout: 15000 }).catch(() => log.warn(`Timed out waiting for ${a.waitFor}`));
    } else {
      log.warn(`Unknown action ${JSON.stringify(a)} — skipped`);
    }
  }
  log.progressDone(`   ${label}: ${(frame / fps).toFixed(1)}s (${frame} frames)`);
  if (errors.length) log.info(`(${errors.length} script error(s) on the page were ignored)`);
  await page.close();
  return frame;
}

module.exports = { launchBrowser, createContext, recordPage };
