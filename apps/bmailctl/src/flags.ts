/**
 * flags.ts — argv parsing for bmailctl.
 *
 * Deliberately tiny and explicit (no dependency): the flag surface is the
 * v0 one, minus the dead --print-password flag (parsed there, never read),
 * plus --lean for `org records`.
 */

// ── the parsed shape ──────────────────────────────────────────────────────────

export interface CliFlags {
  json?: boolean;
  yes?: boolean;
  webmail?: boolean;
  clear?: boolean;
  lean?: boolean;
  password?: string;
  name?: string;
  domain?: string;
}

export interface ParsedArgv {
  positionals: string[];
  flags: CliFlags;
}

// ── the parser ────────────────────────────────────────────────────────────────

export function parseFlags(argv: string[]): ParsedArgv {
  const positionals: string[] = [];
  const flags: CliFlags = {};

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];

    if (argument === '--json') {
      flags.json = true;
    } else if (argument === '--yes' || argument === '-y') {
      flags.yes = true;
    } else if (argument === '--webmail') {
      flags.webmail = true;
    } else if (argument === '--clear') {
      flags.clear = true;
    } else if (argument === '--lean') {
      flags.lean = true;
    } else if (argument === '--password') {
      flags.password = argv[++index];
    } else if (argument.startsWith('--password=')) {
      flags.password = argument.slice('--password='.length);
    } else if (argument === '--name') {
      flags.name = argv[++index];
    } else if (argument.startsWith('--name=')) {
      flags.name = argument.slice('--name='.length);
    } else if (argument === '--domain') {
      flags.domain = argv[++index];
    } else if (argument.startsWith('--domain=')) {
      flags.domain = argument.slice('--domain='.length);
    } else {
      positionals.push(argument);
    }
  }

  return { positionals, flags };
}
