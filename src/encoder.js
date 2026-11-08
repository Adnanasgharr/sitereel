'use strict';
// Turns frame sequences into the final MP4: one clip per page, joined with a crossfade or a cut.
// Uses only basic ffmpeg filters (blend/trim/concat), so it works with old and new ffmpeg builds.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function ffmpegPath() {
  if (process.env.SITEREEL_FFMPEG) return process.env.SITEREEL_FFMPEG;
  try { return require('@ffmpeg-installer/ffmpeg').path; } catch { return 'ffmpeg'; }
}

function run(args) {
  try {
    execFileSync(ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    throw new Error('ffmpeg failed: ' + String(e.stderr || e.message).trim().slice(0, 1500));
  }
}

function settings(cfg) {
  if (cfg.draft) return { preset: 'veryfast', crf: 26, clipCrf: 20 };
  if (cfg.quality === '4k') return { preset: 'slow', crf: 18, clipCrf: 14 };
  return { preset: 'slow', crf: 17, clipCrf: 12 };
}

const finalArgs = (cfg, out) => {
  const s = settings(cfg);
  return ['-r', String(cfg.fps), '-c:v', 'libx264', '-preset', s.preset, '-crf', String(s.crf), '-profile:v', 'high',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
};

/** pages: [{ dir, frames }] in order. */
function encode(cfg, pages, out) {
  const fps = cfg.fps;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const evenScale = 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1';

  if (pages.length === 1) {
    run(['-framerate', String(fps), '-i', path.join(pages[0].dir, 'f%06d.jpg'), '-vf', `${evenScale},format=yuv420p`, ...finalArgs(cfg, out)]);
    return pages[0].frames / fps;
  }

  // 1) one high-quality intermediate clip per page
  const s = settings(cfg);
  const clips = pages.map((p, i) => {
    const clip = path.join(path.dirname(p.dir), `page-${i + 1}.mp4`);
    run(['-framerate', String(fps), '-i', path.join(p.dir, 'f%06d.jpg'), '-vf', evenScale, '-c:v', 'libx264',
      '-preset', cfg.draft ? 'veryfast' : 'fast', '-crf', String(s.clipCrf), '-pix_fmt', 'yuv420p', clip]);
    return { clip, frames: p.frames };
  });

  // 2) join: crossfade = blend the last N frames of page i with the first N frames of page i+1
  const n = clips.length;
  const want = cfg.transition.type === 'crossfade' ? Math.round(cfg.transition.duration * fps) : 0;
  const XF = Math.max(0, Math.min(want, ...clips.map((c) => Math.floor(c.frames / 2) - 1)));
  let g = ''; const parts = [];
  clips.forEach((c, i) => {
    const head = XF > 0 && i > 0; const tail = XF > 0 && i < n - 1;
    const outs = []; if (head) outs.push(`h${i}`); outs.push(`b${i}`); if (tail) outs.push(`t${i}`);
    g += `[${i}:v]setpts=PTS-STARTPTS,split=${outs.length}${outs.map((o) => `[s${o}]`).join('')};`;
    const trim = (lbl, a, b) => { g += `[s${lbl}]trim=start_frame=${a}:end_frame=${b},setpts=PTS-STARTPTS[${lbl}];`; };
    if (head) trim(`h${i}`, 0, XF);
    trim(`b${i}`, head ? XF : 0, tail ? c.frames - XF : c.frames);
    if (tail) trim(`t${i}`, c.frames - XF, c.frames);
  });
  const secs = (XF / fps).toFixed(4);
  for (let i = 0; i < n; i++) {
    parts.push(`[b${i}]`);
    if (XF > 0 && i < n - 1) { g += `[t${i}][h${i + 1}]blend=all_expr='A*(1-T/${secs})+B*(T/${secs})'[x${i}];`; parts.push(`[x${i}]`); }
  }
  g += `${parts.join('')}concat=n=${parts.length}:v=1:a=0,format=yuv420p,setsar=1[out]`;
  const args = [];
  clips.forEach((c) => args.push('-i', c.clip));
  run([...args, '-filter_complex', g, '-map', '[out]', ...finalArgs(cfg, out)]);
  return (clips.reduce((a, c) => a + c.frames, 0) - XF * (n - 1)) / fps;
}

module.exports = { encode, ffmpegPath };
