/**
 * session-store.ts — In-RAM session index.
 *
 * The per-user IMAP password lives here (RAM only, never written to disk or
 * logged, never sent to the client). The session cookie carries only ids.
 *
 * Migration note: verifyImapCredentials now takes the OrgRegistry explicitly
 * instead of reading a module-level org list.
 */

import { ImapFlow } from 'imapflow';

import type { OrgRegistry } from './org-registry.js';

// ─── Session shape ─────────────────────────────────────

export interface Session {
  sid: string;
  userId: string;
  email: string;
  password: string;
  org: string;
  createdAt: number;
  lastSeen: number;
}

// ─── Store ─────────────────────────────────────────────

export class SessionStore {
  private readonly byId = new Map<string, Session>();

  create(sid: string, userId: string, email: string, password: string, org: string): Session {
    const now = Date.now();
    const session: Session = {
      sid,
      userId,
      email,
      password,
      org,
      createdAt: now,
      lastSeen: now,
    };
    this.byId.set(sid, session);
    return session;
  }

  get(sid: string): Session | undefined {
    const session = this.byId.get(sid);
    if (session) {
      session.lastSeen = Date.now();
    }
    return session;
  }

  delete(sid: string): void {
    this.byId.delete(sid);
  }
}

// ─── Credential check ──────────────────────────────────

/** Validate credentials by attempting a real IMAP login against the org's host. */
export async function verifyImapCredentials(
  registry: OrgRegistry,
  email: string,
  password: string,
): Promise<boolean> {
  const org = registry.getOrgForEmail(email);
  if (!org) {
    return false;
  }

  const client = new ImapFlow({
    host: org.imap.host,
    port: org.imap.port,
    secure: org.imap.secure,
    auth: { user: email, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    await client.logout();
    return true;
  } catch {
    try {
      client.close();
    } catch {
      // Already closed — nothing to clean up.
    }
    return false;
  }
}
