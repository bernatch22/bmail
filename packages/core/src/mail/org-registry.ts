/**
 * org-registry.ts — Multi-tenant org registry and display-name resolution.
 *
 * In bermail this lived in core/config.ts as a hardcoded module-level array.
 * Here the registry is DATA: an OrgRegistry instance built from an injected
 * array or loaded from a JSON file, so adding an org is a config change and
 * not a redeploy. The three production orgs remain available as a default
 * fixture (DEFAULT_ORGS) so the server keeps working with zero config.
 *
 * BMail has no user database — Maddy (IMAP) is the identity provider and the
 * org is derived from the email domain.
 */

import fs from 'node:fs';

import type { OrgConfig, ImapConnConfig } from '../types/index.js';

// ─── Default fixture ───────────────────────────────────

/**
 * The orgs allowed to log in today. Every org's mail is hosted on the same
 * Maddy box; kept per-org so a future org can point at a different IMAP host.
 */
export const DEFAULT_ORGS: OrgConfig[] = [
  {
    domain: 'bernardocastro.dev',
    name: 'bernardocastro.dev',
    imap: { host: 'mail.bernardocastro.dev', port: 993, secure: true },
  },
  {
    domain: 'deutschepolska.com',
    name: 'Deutsche Polska',
    imap: { host: 'mail.bernardocastro.dev', port: 993, secure: true },
  },
  {
    // The webmail is also served at https://mail.kickboxingzf.com, but IMAP
    // stays on the shared host: the same bc-mail box receives and stores this
    // domain's mail, exactly like the other two orgs.
    domain: 'kickboxingzf.com',
    name: 'Kick Boxing Zona Franca',
    imap: { host: 'mail.bernardocastro.dev', port: 993, secure: true },
  },
];

// ─── Registry ──────────────────────────────────────────

export class OrgRegistry {
  private readonly orgs: OrgConfig[];

  constructor(orgs: OrgConfig[] = DEFAULT_ORGS) {
    this.orgs = orgs;
  }

  /**
   * Load the registry from a JSON file containing an array of OrgConfig.
   * Throws on a missing or malformed file — a server booting with a broken
   * org list should fail loudly, not silently allow nobody in.
   */
  static fromJsonFile(filePath: string): OrgRegistry {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(raw)) {
      throw new Error(`Org registry file must contain a JSON array: ${filePath}`);
    }
    return new OrgRegistry(raw as OrgConfig[]);
  }

  /** All registered orgs (read-only view). */
  list(): readonly OrgConfig[] {
    return this.orgs;
  }

  /** Resolve the org for an email by its domain, or undefined if not allowed. */
  getOrgForEmail(email: string): OrgConfig | undefined {
    const domain = email.split('@')[1]?.toLowerCase();
    return this.orgs.find((org) => org.domain === domain);
  }
}

// ─── User ids ──────────────────────────────────────────

/** Stable, readable per-user id derived from the email. */
export function emailToUserId(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

// ─── Per-user account config ───────────────────────────

/**
 * Per-user account config consumed by ImapService / ImapMonitor.
 * `oauth` is kept optional purely for type-compatibility with those classes
 * (which branch on it); self-hosted accounts use password auth.
 */
export interface AccountConfig {
  id: string;
  label: string;
  user: string;
  pass?: string;
  oauth?: { clientId: string; tenantId: string };
  imap: ImapConnConfig;
}

/** Build the ImapService/Monitor config for a logged-in user. */
export function buildAccountConfig(
  registry: OrgRegistry,
  email: string,
  pass: string,
): AccountConfig {
  const org = registry.getOrgForEmail(email);
  if (!org) {
    throw new Error(`Email domain not allowed: ${email}`);
  }

  return {
    id: emailToUserId(email),
    label: `${org.name} — ${email}`,
    user: email,
    pass,
    imap: org.imap,
  };
}

// ─── Display names ─────────────────────────────────────

/**
 * Sender display names ("Name" <email>). The seed map is the fallback; the
 * live source of truth is a JSON file on the mail box managed by
 * `bmailctl account name` (so names change with zero redeploy).
 * Resolution order: file entry → seed entry → capitalized local-part.
 */
export const DEFAULT_DISPLAY_NAMES: Record<string, string> = {
  'me@bernardocastro.dev': 'Bernardo Castro',
  'hello@bernardocastro.dev': 'Bernardo Castro',
  'hello@deutschepolska.com': 'Deutsche Polska',
  'gabriel@deutschepolska.com': 'Gabriel',
  'karina@deutschepolska.com': 'Karina',
  'rodrigo@deutschepolska.com': 'Rodrigo',
  'nicolas@deutschepolska.com': 'Nicolás',
};

export const DEFAULT_DISPLAY_NAMES_PATH = '/etc/bmail/display-names.json';

/**
 * Resolves display names against the CLI-managed override file. The file is
 * read lazily and re-read only when its mtime changes, so a name edit is
 * picked up live without a restart. Absent locally (dev) → seed map is used.
 */
export class DisplayNameResolver {
  private readonly filePath: string;
  private readonly seedNames: Record<string, string>;

  // mtime cache: avoid re-reading and re-parsing the file on every send.
  private fileNames: Record<string, string> = {};
  private fileMtime = -1;

  constructor(
    filePath: string = process.env.DISPLAY_NAMES_PATH || DEFAULT_DISPLAY_NAMES_PATH,
    seedNames: Record<string, string> = DEFAULT_DISPLAY_NAMES,
  ) {
    this.filePath = filePath;
    this.seedNames = seedNames;
  }

  /** Display name to use in the From header for a given address. */
  nameFor(email: string): string {
    const normalized = email.trim().toLowerCase();

    const fromFile = this.readFileNames()[normalized];
    if (fromFile) {
      return fromFile;
    }

    if (this.seedNames[normalized]) {
      return this.seedNames[normalized];
    }

    // Last resort: derive a readable name from the local part.
    const localPart = (normalized.split('@')[0] || normalized).replace(/[._-]+/g, ' ');
    return localPart.replace(/\b\w/g, (character) => character.toUpperCase());
  }

  private readFileNames(): Record<string, string> {
    try {
      const stats = fs.statSync(this.filePath);

      if (stats.mtimeMs !== this.fileMtime) {
        this.fileMtime = stats.mtimeMs;

        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        const normalized: Record<string, string> = {};
        for (const [address, name] of Object.entries(raw)) {
          if (typeof name === 'string' && name.trim()) {
            normalized[address.toLowerCase()] = name;
          }
        }
        this.fileNames = normalized;
      }
    } catch {
      // File missing or unreadable (typical in dev) → fall back to the seed.
      this.fileMtime = -1;
      this.fileNames = {};
    }

    return this.fileNames;
  }
}
