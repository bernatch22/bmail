/**
 * ui.ts — the few ANSI escape codes the installer's report needs.
 *
 * Colors are gated on a real TTY (and NO_COLOR): the report is also read
 * from pipes — a hook, CI, an agent capturing output — and escape codes
 * there are noise, not emphasis.
 */

function colorsEnabled(): boolean {
  try {
    return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
  } catch {
    return false;
  }
}

function wrap(open: string, close: string): (text: string) => string {
  return (text: string) => (colorsEnabled() ? `${open}${text}${close}` : text);
}

export const c = {
  dim: wrap('\x1b[2m', '\x1b[22m'),
  bold: wrap('\x1b[1m', '\x1b[22m'),
  green: wrap('\x1b[32m', '\x1b[39m'),
  red: wrap('\x1b[31m', '\x1b[39m'),
  cyan: wrap('\x1b[36m', '\x1b[39m'),
  yellow: wrap('\x1b[33m', '\x1b[39m'),
};
