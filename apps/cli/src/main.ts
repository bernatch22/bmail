#!/usr/bin/env node
/**
 * main.ts — bmailctl entry point and command dispatcher.
 *
 * A thin CLI over @bmail/admin: this file only parses argv, builds the
 * config (defaults → BMAIL_* env → ~/.bmailctl.json), and routes to the
 * command modules. All operational logic lives in the library.
 *
 * Command surface and aliases are kept compatible with bmailctl v0:
 * account|acct create/list|ls/passwd|password/name/delete|rm and
 * org|domain add/list|ls/verify|status — plus the new `org records`.
 */

import { loadConfig } from '@bmail/admin';

import { parseFlags } from './flags.js';
import { loadUserConfigOverrides } from './user-config.js';
import { CliOutput } from './output.js';
import { HELP_TEXT, CLI_VERSION } from './help.js';
import {
  accountCreate,
  accountList,
  accountPasswd,
  accountName,
  accountDelete,
} from './commands/account.js';
import { orgAdd, orgList, orgVerify, orgRecords } from './commands/org.js';

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArguments = process.argv.slice(2);

  // Help and version answer before any parsing or config loading.
  if (
    rawArguments.length === 0 ||
    rawArguments[0] === '-h' ||
    rawArguments[0] === '--help' ||
    rawArguments[0] === 'help'
  ) {
    console.log(HELP_TEXT);
    return;
  }

  if (rawArguments[0] === '-v' || rawArguments[0] === '--version' || rawArguments[0] === 'version') {
    console.log(CLI_VERSION);
    return;
  }

  const { positionals, flags } = parseFlags(rawArguments);
  const output = new CliOutput(!!flags.json);
  const [group, command, ...rest] = positionals;

  try {
    // ~/.bmailctl.json wins over env, which wins over defaults.
    const config = loadConfig(process.env, loadUserConfigOverrides());

    // ── accounts ──────────────────────────────────────────────────────────
    if (group === 'account' || group === 'acct') {
      if (command === 'create') {
        return await accountCreate(config, output, rest[0], flags);
      }
      if (command === 'list' || command === 'ls') {
        return await accountList(config, output, flags);
      }
      if (command === 'passwd' || command === 'password') {
        return await accountPasswd(config, output, rest[0], flags);
      }
      if (command === 'name') {
        return await accountName(config, output, rest[0], rest[1], flags);
      }
      if (command === 'delete' || command === 'rm') {
        return await accountDelete(config, output, rest[0], flags);
      }

      throw new Error(`unknown account command: ${command || '(none)'}\n\n${HELP_TEXT}`);
    }

    // ── organizations ─────────────────────────────────────────────────────
    if (group === 'org' || group === 'domain') {
      if (command === 'add') {
        return await orgAdd(config, output, rest[0], flags);
      }
      if (command === 'list' || command === 'ls') {
        return await orgList(config, output);
      }
      if (command === 'verify' || command === 'status') {
        return await orgVerify(config, output, rest[0]);
      }
      if (command === 'records') {
        return await orgRecords(config, output, rest[0], flags);
      }

      throw new Error(`unknown org command: ${command || '(none)'}\n\n${HELP_TEXT}`);
    }

    console.log(HELP_TEXT);
  } catch (error) {
    const message = (error as Error).message || String(error);

    output.fail(message);

    // Under --json, errors also land on stdout so a pipeline sees them.
    if (output.jsonMode) {
      console.log(JSON.stringify({ error: message }));
    }

    process.exit(1);
  }
}

main();
