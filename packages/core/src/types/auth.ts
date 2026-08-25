/**
 * auth.ts — Authentication and multi-tenant (org) types.
 *
 * BMail has no user database: Maddy (IMAP) is the identity provider, and the
 * org is derived from the email domain. The org REGISTRY (the actual list of
 * allowed domains) stays in the engine/config layer — this package only owns
 * the shapes.
 */

// ─── Authenticated user ────────────────────────────────

/** What the server tells the client about the logged-in session. */
export interface AuthUser {
  email: string;
  /** Org display name, resolved from the email domain */
  org: string;
}

// ─── Orgs ──────────────────────────────────────────────

/** Connection parameters for an org's IMAP host. */
export interface ImapConnConfig {
  host: string;
  port: number;
  secure: boolean;
}

/**
 * One tenant. Today every org's mail is hosted on the same Maddy box, but the
 * config is kept per-org so a future org can point at a different IMAP host.
 */
export interface OrgConfig {
  /** Email domain, e.g. "deutschepolska.com" */
  domain: string;
  /** Display name shown in the UI */
  name: string;
  imap: ImapConnConfig;
}
