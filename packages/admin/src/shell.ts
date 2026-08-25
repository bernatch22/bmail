/**
 * shell.ts — the one place @bmail/admin touches child processes.
 *
 * Everything the package does ultimately runs a local binary (ssh, aws).
 * This module wraps execFile with the buffer sizes and quoting helpers the
 * rest of the package needs, so no other module imports child_process.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const promisifiedExecFile = promisify(execFile);

// Remote command output can be large (mailbox listings, JSON blobs), so we
// give every child a generous buffer instead of tuning per call site.
const MAX_OUTPUT_BUFFER = 32 * 1024 * 1024;

// ── running a binary ──────────────────────────────────────────────────────────

export interface RunResult {
  stdout: string;
  stderr: string;
}

// Run a local binary with arguments; resolves with its output, rejects on a
// non-zero exit (the rejection carries stderr, which callers inspect).
export async function runCommand(binary: string, args: string[]): Promise<RunResult> {
  const { stdout, stderr } = await promisifiedExecFile(binary, args, {
    maxBuffer: MAX_OUTPUT_BUFFER,
  });

  return { stdout, stderr };
}

// ── quoting for remote shells ─────────────────────────────────────────────────

// Escape a value for inclusion inside single quotes in a remote POSIX shell
// command ('it''s' style). Used by every module that builds ssh commands.
export function quoteForSingleQuotes(value: string): string {
  return String(value).replace(/'/g, `'\\''`);
}
