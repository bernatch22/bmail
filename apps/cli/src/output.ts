/**
 * output.ts — how bmailctl talks to the terminal.
 *
 * The contract inherited from v0: human narration goes to STDERR in color,
 * machine output (--json) goes to STDOUT as one JSON document. That split
 * is what makes `bmailctl … --json | jq` work while a human still sees the
 * progress lines. This module owns the ANSI codes, the InfraLogger the
 * infra package narrates through, and the confirmation prompt.
 */

import { createInterface } from 'node:readline';
import type { InfraLogger } from '@bmail/admin';

// ── ansi colors ───────────────────────────────────────────────────────────────

export const color = {
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
};

// ── the output channel ────────────────────────────────────────────────────────

// One instance per run; jsonMode silences every human line so stdout stays
// a single clean JSON document.
export class CliOutput {
  constructor(public readonly jsonMode: boolean) {}

  // A plain human line on stderr (suppressed under --json).
  info(...parts: string[]): void {
    if (!this.jsonMode) {
      console.error(...parts);
    }
  }

  ok(message: string): void {
    this.info(color.green('✓ ') + message);
  }

  step(message: string): void {
    this.info(color.cyan('→ ') + message);
  }

  fail(message: string): void {
    if (!this.jsonMode) {
      console.error(color.red('✗ ') + message);
    }
  }

  // The one thing that goes to stdout: the machine-readable result.
  emit(payload: unknown): void {
    if (this.jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
    }
  }

  // Adapter so @bmail/admin operations can narrate through this channel.
  asInfraLogger(): InfraLogger {
    return {
      step: (message) => this.step(message),
      ok: (message) => this.ok(message),
      warn: (message) => this.info(color.yellow('  ⚠ ' + message)),
      detail: (message) => this.info(color.dim('  ' + message)),
    };
  }
}

// ── confirmations ─────────────────────────────────────────────────────────────

// Ask a question on stderr and read one line from stdin.
function askQuestion(question: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stderr });

  return new Promise((resolve) => {
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer.trim());
    });
  });
}

// y/N confirmation; `force` (the -y flag) skips it for scripts.
export async function confirm(question: string, force: boolean | undefined): Promise<boolean> {
  if (force) {
    return true;
  }

  const answer = (await askQuestion(`${question} ${color.dim('[y/N]')} `)).toLowerCase();

  return answer === 'y' || answer === 'yes';
}
