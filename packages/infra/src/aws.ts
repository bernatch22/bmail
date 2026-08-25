/**
 * aws.ts — run the `aws` CLI and parse its JSON answer.
 *
 * SES and Route 53 are driven through the operator's local ~/.aws creds,
 * exactly like bmailctl v0 did. Every call forces --output json so the
 * result is machine-readable regardless of the operator's CLI defaults.
 */

import { runCommand } from './shell.js';

// ── the wrapper ───────────────────────────────────────────────────────────────

// Run `aws <args> --output json`; returns the parsed JSON, or null when the
// command produced no output (some mutations answer with an empty body).
export async function runAws(args: string[]): Promise<any> {
  const { stdout } = await runCommand('aws', [...args, '--output', 'json']);

  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  return JSON.parse(trimmed);
}

// Extract the useful text from a failed aws invocation, for matching
// against known error markers like "AlreadyExists".
export function awsErrorText(error: unknown): string {
  const withStreams = error as { stderr?: string; message?: string };
  return String(withStreams.stderr || withStreams.message || error);
}
