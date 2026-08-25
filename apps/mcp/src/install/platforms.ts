/**
 * platforms.ts — which AI coding assistants exist, and where each keeps
 * its MCP config.
 *
 * The bmail MCP server is portable — the SAME stdio server works in every
 * host below. Only the config file differs (path, format, key), so the
 * differences live here as data and every other module in this folder is
 * format-agnostic. The platform set mirrors pinecall's installer.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const SERVER_NAME = 'bmail';

export type Format = 'json' | 'toml';

export interface Platform {
  label: string;
  /** Config file path, relative to $HOME. */
  path: string;
  fmt: Format;
  /** The top-level table of MCP servers in that file. */
  key: string;
  /**
   * Relative to $HOME. What proves the product is installed even before it
   * has ever written an MCP config — a fresh install has the directory and
   * no file yet.
   */
  dirHint: string;
}

export const PLATFORMS: Record<string, Platform> = {
  claude: {
    label: 'Claude Code',
    path: '.claude.json',
    fmt: 'json',
    key: 'mcpServers',
    dirHint: '.claude',
  },
  codex: {
    label: 'Codex',
    path: '.codex/config.toml',
    fmt: 'toml',
    key: 'mcp_servers',
    dirHint: '.codex',
  },
  antigravity: {
    label: 'Antigravity',
    path: '.gemini/antigravity/mcp_config.json',
    fmt: 'json',
    key: 'mcpServers',
    dirHint: '.gemini/antigravity',
  },
  cursor: {
    label: 'Cursor',
    path: '.cursor/mcp.json',
    fmt: 'json',
    key: 'mcpServers',
    dirHint: '.cursor',
  },
  windsurf: {
    label: 'Windsurf',
    path: '.codeium/windsurf/mcp_config.json',
    fmt: 'json',
    key: 'mcpServers',
    dirHint: '.codeium/windsurf',
  },
  // NOT ".gemini" as the hint — that directory also exists for Antigravity,
  // which nests under it; keying off the settings FILE avoids claiming
  // Gemini CLI is installed when only Antigravity is.
  gemini: {
    label: 'Gemini CLI',
    path: '.gemini/settings.json',
    fmt: 'json',
    key: 'mcpServers',
    dirHint: '.gemini/settings.json',
  },
};

// ── the entry we write ────────────────────────────────────────────────────────

export interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Absolute path to THIS build's dist/main.js, resolved from the installer's
 * own location (this file compiles to dist/install/platforms.js). A private
 * monorepo has no npm package to `npx`, so the entry pins the built server
 * next to the installer — the one thing guaranteed to be the right version
 * of itself.
 */
export function serverMainPath(): string {
  const installDirectory = dirname(fileURLToPath(import.meta.url));
  return join(installDirectory, '..', 'main.js');
}

/**
 * The server entry.
 *
 * No `env` block by default — BMAIL_MCP_EMAIL/BMAIL_MCP_PASSWORD are never
 * written into anybody's config file unless the user explicitly passes
 * --with-env, in which case the values are copied from the CURRENT
 * environment at install time.
 */
export function entry(withEnv = false): ServerEntry {
  const serverEntry: ServerEntry = {
    command: 'node',
    args: [serverMainPath()],
  };

  if (withEnv) {
    const env: Record<string, string> = {};
    if (process.env.BMAIL_MCP_EMAIL) {
      env.BMAIL_MCP_EMAIL = process.env.BMAIL_MCP_EMAIL;
    }
    if (process.env.BMAIL_MCP_PASSWORD) {
      env.BMAIL_MCP_PASSWORD = process.env.BMAIL_MCP_PASSWORD;
    }
    if (Object.keys(env).length > 0) {
      serverEntry.env = env;
    }
  }

  return serverEntry;
}
