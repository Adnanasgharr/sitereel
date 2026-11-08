#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('util');
const { buildConfig, FORMATS, SPEEDS } = require('../src/config');
const { launchBrowser, createContext, recordPage } = require('../src/recorder');
const { encode } = require('../src/encoder');
const log = require('../src/log');
const pkg = require('../package.json');

const HELP = `
sitereel ${pkg.version} — turn any website into a smooth scroll video

USAGE
  sitereel <url> [options]            record a website (auto mode)
  sitereel --config <file> [options]  record using a settings file
  sitereel init [url]                 create a starter settings file (sitereel.json)

OPTIONS
  -c, --config <file>        settings file (JSON). Flags below override it.
  -p, --pages <list>         pages to record, comma-separated:  --pages "/,/about,/contact"
  -f, --format <f>           ${Object.keys(FORMATS).join(' | ')} | custom   (default 16:9)
      --width <px>           custom format: viewport width   (with --height)
      --height <px>          custom format: viewport height
  -q, --quality <q>          1080p | 4k                       (default 1080p)
      --fps <n>              30 | 60                          (default 60)
  -s, --speed <s>            ${Object.keys(SPEEDS).join(' | ')} | <pixels per second>   (default medium)
  -t, --transition <t>       crossfade | cut                  (default crossfade)
      --crossfade <sec>      crossfade length in seconds      (default 0.8)
      --pause <sec>          pause at each section            (default 0.9)
      --no-auto-pauses       don't pause on sections, just scroll
      --start-hold <sec>     wait at the top of each page     (default 2.5)
      --end-hold <sec>       hold at the end of each page     (default 1.5)
      --hide <selector>      hide an element (repeatable): --hide ".chat" --hide "#promo"
      --css <css|file.css>   extra CSS to inject
      --cookies <file>       cookies JSON (for logged-in pages)
      --storage-state <file> Playwright storage state (for logged-in pages)
      --mobile               emulate a phone (on by default for 9:16)
      --scroll-mode <m>      auto | wheel | native            (default auto)
      --browser <b>          auto | chrome | msedge | chromium (default auto)
      --headed               show the browser window while recording
      --draft                fast low-res preview (half size, 15fps) to check timing
  -o, --out <file.mp4>       output file
      --keep-frames          keep the rendered frames next to the video
  -h, --help                 show this help
  -v, --version              show the version

EXAMPLES
  sitereel https://example.com
  sitereel https://example.com --pages "/,/about" --format 9:16 --draft
  sitereel --config examples/multi-page.json --quality 4k
`;

const OPTIONS = {
  config: { type: 'string', short: 'c' },
  pages: { type: 'string', short: 'p' },
  format: { type: 'string', short: 'f' },
  width: { type: 'string' },
  height: { type: 'string' },
  quality: { type: 'string', short: 'q' },
  fps: { type: 'string' },
  speed: { type: 'string', short: 's' },
  transition: { type: 'string', short: 't' },
  crossfade: { type: 'string' },
  pause: { type: 'string' },
  'no-auto-pauses': { type: 'boolean' },
  'start-hold': { type: 'string' },
  'end-hold': { type: 'string' },
  hide: { type: 'string', multiple: true },
  css: { type: 'string' },
  cookies: { type: 'string' },
  'storage-state': { type: 'string' },
  mobile: { type: 'boolean' },
  'scroll-mode': { type: 'string' },
  browser: { type: 'string' },
  headed: { type: 'boolean' },
  draft: { type: 'boolean' },
  out: { type: 'string', short: 'o' },
  'keep-frames': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function starterConfig(url) {
  return {
    url: url || 'https://example.com',
    format: '16:9',
    quality: '1080p',
    fps: 60,
    speed: 'medium',
    transition: { type: 'crossfade', duration: 0.8 },
    hide: [],
    pages: [
      { path: '/' },
      { path: '/about', pauseOn: ['h2'] },
      {
        path: '/contact',
        actions: [
          { hold: 1 },
          { scrollTo: 'form', offset: 120 },
          { type: 'input[type=email]', text: 'hello@example.com' },
          { hold: 1.5 },
          { scrollTo: 'bottom' },
        ],
      },
    ],
  };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    log.error(e.message.replace(/^.*?: /, ''));
    console.log('Run `sitereel --help` for all options.');
    process.exit(1);
  }
  const { values: flags, positionals } = parsed;
  if (flags.help) { console.log(HELP); return; }
  if (flags.version) { console.log(pkg.version); return; }

  if (positionals[0] === 'init') {
    const file = path.resolve(flags.out && flags.out.endsWith('.json') ? flags.out : 'sitereel.json');
    if (fs.existsSync(file)) { log.error(`${path.basename(file)} already exists — not overwriting it.`); process.exit(1); }
    fs.writeFileSync(file, JSON.stringify(starterConfig(positionals[1]), null, 2) + '\n');
    log.ok(`Created ${file}`);
    console.log('Edit it, then run:  sitereel --config ' + path.basename(file));
    return;
  }

  if (positionals[0]) flags.url = positionals[0];
  let cfg;
  try { cfg = buildConfig(flags); } catch (e) { log.error(e.message); console.log('Run `sitereel --help` for all options.'); process.exit(1); }

  log.title(`sitereel — ${cfg.pages.length} page${cfg.pages.length > 1 ? 's' : ''} → ${path.basename(cfg.out)}`);
  log.info(`${cfg.format} · ${cfg.output.width}×${cfg.output.height} · ${cfg.fps}fps · speed ${cfg.speed} · ${cfg.transition.type}${cfg.draft ? ' · DRAFT' : ''}`);

  const work = cfg.keepFrames
    ? path.join(path.dirname(cfg.out), '.sitereel-frames', path.basename(cfg.out, '.mp4'))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'sitereel-'));
  fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });

  const started = Date.now();
  let browser;
  const cleanup = () => { if (!cfg.keepFrames) fs.rmSync(work, { recursive: true, force: true }); };
  process.on('SIGINT', async () => { log.warn('Stopped.'); try { await browser?.close(); } catch {} cleanup(); process.exit(130); });

  try {
    browser = await launchBrowser(cfg);
    const ctx = await createContext(browser, cfg);
    const results = [];
    for (let i = 0; i < cfg.pages.length; i++) {
      const dir = path.join(work, `page-${i + 1}`);
      const frames = await recordPage(ctx, cfg, cfg.pages[i], dir, `Page ${i + 1}/${cfg.pages.length}`);
      results.push({ dir, frames });
    }
    await browser.close(); browser = null;

    log.step('Encoding video…');
    const seconds = encode(cfg, results, cfg.out);
    const mb = (fs.statSync(cfg.out).size / 1e6).toFixed(1);
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    log.ok(`Done: ${cfg.out}`);
    log.info(`${seconds.toFixed(1)}s · ${cfg.output.width}×${cfg.output.height} · ${cfg.fps}fps · ${mb} MB · made in ${mins} min`);
  } catch (e) {
    log.error(e.message);
    process.exitCode = 1;
  } finally {
    try { await browser?.close(); } catch {}
    cleanup();
  }
}

main();
