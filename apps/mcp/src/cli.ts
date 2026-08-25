/**
 * cli.ts — the binary's ARGUMENT side: `bmail-mcp install`, and everything
 * around it.
 *
 * With no arguments (or `serve`) the binary is the stdio SERVER, because
 * that is what an MCP host launches — arguments are the exception, not the
 * entry. `install` wires the built server into every assistant config found
 * on this machine; the pattern is ported from pinecall's self-installer.
 */

import { apply, detect } from './install/apply.js';
import { PLATFORMS } from './install/platforms.js';
import { render, renderDetected } from './install/render.js';
import { c } from './ui.js';

const VERSION = '0.1.0';

const HELP = `
  ${c.bold('bmail-mcp')} ${c.dim(`v${VERSION}`)} — the bmail platform as an MCP server

  ${c.bold('Usage:')}
    ${c.dim('$')} bmail-mcp                    ${c.dim('Run the stdio server (hosts launch this)')}
    ${c.dim('$')} bmail-mcp install            ${c.dim('Wire it into every assistant found here')}
    ${c.dim('$')} bmail-mcp install <platform> ${c.dim('Only the ones you name')}
    ${c.dim('$')} bmail-mcp install --list     ${c.dim('Show what is detected, change nothing')}
    ${c.dim('$')} bmail-mcp install --remove   ${c.dim('Take the bmail entry back out')}
    ${c.dim('$')} bmail-mcp install --with-env ${c.dim('Also copy BMAIL_MCP_EMAIL/PASSWORD into the config')}

  ${c.bold('Platforms:')}
${Object.entries(PLATFORMS)
  .map(([key, platform]) => `    ${c.cyan(key.padEnd(13))}${c.dim(`~/${platform.path}`)}`)
  .join('\n')}

  ${c.bold('Notes')}
    ${c.dim('Each config is backed up to <file>.bak before it is written.')}
    ${c.dim('Re-running repairs a drifted entry — it never adds a second one.')}
    ${c.dim('Credentials are NOT written to any config unless you pass')} ${c.cyan('--with-env')}${c.dim(':')}
    ${c.dim('the server reads')} ${c.cyan('BMAIL_MCP_EMAIL')}${c.dim('/')}${c.cyan('BMAIL_MCP_PASSWORD')} ${c.dim('from its environment.')}
`;

/** Returns true when the arguments were a command — i.e. do NOT start the server. */
export function runCli(argv: string[]): boolean {
  const args = argv.slice(2);
  const sub = args.find((arg) => !arg.startsWith('-'));
  const flags = args.filter((arg) => arg.startsWith('-'));

  if (flags.includes('--help') || flags.includes('-h')) {
    console.log(HELP);
    return true;
  }
  if (flags.includes('--version') || flags.includes('-v')) {
    console.log(VERSION);
    return true;
  }

  // No command, or an explicit `serve` → this is a server launch.
  if (!sub || sub === 'serve') {
    return false;
  }

  if (sub !== 'install' && sub !== 'uninstall') {
    console.error(
      `\n  ${c.red('✗')} Unknown command: ${sub}\n\n  Run ${c.dim('bmail-mcp --help')} for usage.\n`,
    );
    process.exit(1);
  }

  const remove = sub === 'uninstall' || flags.includes('--remove');
  const withEnv = flags.includes('--with-env');
  const platforms = args.filter((arg) => !arg.startsWith('-') && arg !== sub);

  if (flags.includes('--list')) {
    console.log(renderDetected(detect()));
    return true;
  }

  try {
    console.log(render(apply({ platforms, remove, withEnv }), remove, withEnv && !remove));
  } catch (error) {
    console.error(`\n  ${c.red('✗')} ${(error as Error).message}\n`);
    process.exit(1);
  }
  return true;
}
