/**
 * ssh.ts — run a command on the Maddy box over `gcloud compute ssh`.
 *
 * v0 of the stack has no admin API on the box, so every Maddy operation is
 * a remote shell command. This module owns the gcloud invocation details:
 * the pinned project, the zone, and the IAP-flag compatibility retry.
 */

import type { InfraConfig } from './config.js';
import { runCommand } from './shell.js';

// ── the wrapper ───────────────────────────────────────────────────────────────

// Execute remoteCommand on the configured box and return its stdout.
export async function runOnMailbox(config: InfraConfig, remoteCommand: string): Promise<string> {
  // The project is pinned explicitly: relying on the gcloud default breaks
  // (hangs) whenever a re-login switches it to a project where the Compute
  // API is disabled. See config.ts.
  const baseArguments = [
    'compute',
    'ssh',
    config.box,
    `--zone=${config.zone}`,
    `--project=${config.project}`,
  ];

  try {
    const { stdout } = await runCommand('gcloud', [
      ...baseArguments,
      '--tunnel-through-iap=false',
      '--command',
      remoteCommand,
    ]);
    return stdout;
  } catch (error) {
    // Older gcloud releases do not know the IAP flag at all; when the error
    // names the flag, retry once without it instead of failing the operation.
    const stderrText = String((error as { stderr?: string }).stderr || '');

    if (stderrText.includes('tunnel-through-iap')) {
      const { stdout } = await runCommand('gcloud', [
        ...baseArguments,
        '--command',
        remoteCommand,
      ]);
      return stdout;
    }

    throw error;
  }
}
