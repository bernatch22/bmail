/**
 * render.ts — the two things a person reads: what was found, and what
 * was done.
 */

import { c } from '../ui.js';
import { DONE_ACTIONS, type HostResult, type HostRow } from './apply.js';

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * The report. Every host gets a line, including the skipped ones — a list
 * that only shows successes cannot answer "why isn't Cursor in there".
 */
export function render(results: HostResult[], remove = false, envWritten = false): string {
  const lines = results.map((result) => {
    const ok = DONE_ACTIONS.has(result.action);
    const failed = result.action.startsWith('FAILED');

    const mark = failed ? c.red('✗') : ok ? c.green('✓') : c.dim('·');
    const action = failed ? c.red(result.action) : ok ? c.green(result.action) : c.dim(result.action);

    return `  ${mark} ${c.bold(pad(result.label, 12))} ${pad(action, 24)} ${c.dim(result.path)}`;
  });

  const done = results.filter((result) => DONE_ACTIONS.has(result.action));
  const verb = remove ? 'Unregistered' : 'Registered';
  const head = done.length ? `${verb} bmail in ${done.length} platform(s):` : 'No platforms touched.';

  return `\n  ${c.bold(head)}\n` + lines.join('\n') + tail(done.length > 0 && !remove, envWritten);
}

/**
 * The things that are not obvious: a running assistant has already read
 * its config, and — unless --with-env was passed — the mail credentials
 * live in the environment, NOT in the file we just wrote.
 */
function tail(worthSaying: boolean, envWritten: boolean): string {
  if (!worthSaying) {
    return '\n';
  }

  const credentialsLine = envWritten
    ? `\n  ${c.yellow('Credentials WERE copied into the config (--with-env) — treat those files as secrets.')}`
    : `\n  ${c.dim('No credentials were written to any config — the server reads')} ${c.cyan(
        'BMAIL_MCP_EMAIL',
      )}${c.dim('/')}${c.cyan('BMAIL_MCP_PASSWORD')} ${c.dim('from its environment (or use the mail_login tool).')}`;

  return (
    `\n\n  ${c.dim('Backups written alongside each file as')} ${c.cyan('.bak')}${c.dim('.')}` +
    `\n  ${c.dim('Restart your assistant to pick it up.')}` +
    credentialsLine +
    '\n'
  );
}

/**
 * `--list`: the same table, changing nothing. Three states, not two: a
 * product that is absent, one that is here but unregistered, and one
 * already wired up. Collapsing the first two would send someone to install
 * an editor they already have.
 */
export function renderDetected(rows: HostRow[]): string {
  const lines = rows.map((row) => {
    const state = row.registered ? 'registered' : row.installed ? 'not registered' : 'not installed';
    const mark = row.installed ? c.green('✓') : c.dim('·');
    const shown = row.registered ? c.green(pad(state, 16)) : c.dim(pad(state, 16));

    return `  ${mark} ${c.bold(pad(row.label, 12))} ${shown} ${c.dim(row.path)}`;
  });

  return `\n  ${c.bold('AI coding assistants on this machine:')}\n` + lines.join('\n') + '\n';
}
