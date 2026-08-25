/**
 * user-config.ts — ~/.bmailctl.json overrides.
 *
 * The v0 README promised "overridable via ~/.bmailctl.json" but the code
 * never read the file; this implements it. The file, when present, holds a
 * flat JSON object whose keys are InfraConfig fields (sshTarget,
 * mailHost, mailIp, sesRegion, feedbackHost, …). Precedence stays:
 * defaults < BMAIL_* env < ~/.bmailctl.json (explicit beats ambient).
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InfraConfig } from '@bmail/admin';

// ── reading the file ──────────────────────────────────────────────────────────

export const USER_CONFIG_PATH = join(homedir(), '.bmailctl.json');

// Load the overrides; a missing file is the normal case and yields {}.
// A file that exists but does not parse is a real user error — we throw
// with the path rather than silently ignoring their configuration.
export function loadUserConfigOverrides(): Partial<InfraConfig> {
  let raw: string;

  try {
    raw = readFileSync(USER_CONFIG_PATH, 'utf8');
  } catch {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON in ${USER_CONFIG_PATH}: ${(error as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${USER_CONFIG_PATH} must contain a JSON object`);
  }

  // Only keep string-valued entries: every InfraConfig field is a string,
  // and anything else in the file is a typo we should not propagate.
  const overrides: Record<string, string> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      overrides[key] = value;
    }
  }

  return overrides as Partial<InfraConfig>;
}
