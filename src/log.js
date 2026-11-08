'use strict';
// Small, friendly console output.

const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
let progressShown = false;
const clearProgress = () => { if (progressShown && tty) process.stdout.write('\r\x1b[K'); progressShown = false; };

module.exports = {
  title: (s) => { clearProgress(); console.log('\n' + c('1', s)); },
  step: (s) => { clearProgress(); console.log(c('36', '▸ ') + s); },
  detail: (s) => { clearProgress(); console.log(c('90', '    · ' + s)); },
  info: (s) => { clearProgress(); console.log(c('90', '  ' + s)); },
  ok: (s) => { clearProgress(); console.log(c('32', '✓ ') + s); },
  warn: (s) => { clearProgress(); console.log(c('33', '⚠ ') + s); },
  error: (s) => { clearProgress(); console.error(c('31', '✗ ') + s); },
  progress: (s) => { if (tty) { process.stdout.write('\r\x1b[K' + c('90', s)); progressShown = true; } },
  progressDone: (s) => { clearProgress(); console.log(c('32', '✓') + s.replace(/^\s*/, ' ')); },
};
