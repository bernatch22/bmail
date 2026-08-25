/**
 * ssh.ts — run a command on the Maddy box over plain OpenSSH.
 *
 * v0 of the stack has no admin API on the box, so every Maddy operation is
 * a remote shell command. This module used to shell out to `gcloud compute
 * ssh`; it now uses direct `ssh` with keys, shipway-style: the target is an
 * alias resolved by ~/.ssh/config (Host bc-mail → IP + user + IdentityFile),
 * so no cloud CLI, no re-auth prompts, and it works the same against any
 * provider the box might move to.
 */

import type { InfraConfig } from './config.js';
import { runCommand } from './shell.js';

// ── the wrapper ───────────────────────────────────────────────────────────────

// Execute remoteCommand on the configured box and return its stdout.
export async function runOnMailbox(config: InfraConfig, remoteCommand: string): Promise<string> {
  // BatchMode makes a missing/rejected key fail loudly instead of hanging on
  // an interactive password prompt — this code often runs unattended (CLI,
  // MCP server), where a hang is worse than an error.
  const { stdout } = await runCommand('ssh', [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    config.sshTarget,
    remoteCommand,
  ]);

  return stdout;
}
