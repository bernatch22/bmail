/**
 * infra-config.ts — how the MCP server builds its InfraConfig.
 *
 * Exactly the layering bmailctl uses, so the operator's local gcloud/aws
 * sessions and overrides behave identically from Claude and from the CLI:
 * built-in defaults < BMAIL_* env < ~/.bmailctl.json.
 *
 * The ~/.bmailctl.json reader is duplicated from apps/bmailctl on purpose:
 * apps must not import from each other, and the file format is the shared
 * contract, not the code.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadConfig, type InfraConfig } from '@bmail/infra';

// ── ~/.bmailctl.json overrides ────────────────────────────────────────────────

export const USER_CONFIG_PATH = join(homedir(), '.bmailctl.json');

// A missing file is the normal case and yields {}. A file that exists but
// does not parse is a real user error — throw with the path.
function loadUserConfigOverrides(): Partial<InfraConfig> {
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

  // Every InfraConfig field is a string; anything else is a typo.
  const overrides: Record<string, string> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      overrides[key] = value;
    }
  }

  return overrides as Partial<InfraConfig>;
}

// ── the effective config ──────────────────────────────────────────────────────

/** Build the InfraConfig the admin tools run against. */
export function buildInfraConfig(): InfraConfig {
  return loadConfig(process.env, loadUserConfigOverrides());
}
