/**
 * mail-session.ts — whose mailbox the mail tools operate on.
 *
 * Credentials come from the environment (BMAIL_MCP_EMAIL/BMAIL_MCP_PASSWORD)
 * or from the mail_login tool, which overrides them in-process for the life
 * of the server. Nothing is ever written to disk.
 *
 * Connection strategy: connect-per-call. An MCP server sits idle between
 * tool calls for minutes or hours, and a parked IMAP socket just accumulates
 * reconnect noise; a fresh login to the local Maddy box costs milliseconds.
 * `withImap` opens a connection, runs the operation, and always logs out.
 */

import {
  ImapService,
  OrgRegistry,
  DisplayNameResolver,
  SmtpSender,
  buildAccountConfig,
} from '@bmail/core';

// ── the session ───────────────────────────────────────────────────────────────

export interface MailCredentials {
  email: string;
  password: string;
}

export class MailSession {
  private readonly orgRegistry = new OrgRegistry();
  private readonly displayNames = new DisplayNameResolver();
  readonly smtpSender = new SmtpSender(this.orgRegistry, this.displayNames);

  // mail_login overrides the env credentials for this process.
  private loginOverride: MailCredentials | null = null;

  /** Replace the session credentials (in-process only). Validates the domain. */
  login(email: string, password: string): void {
    if (!this.orgRegistry.getOrgForEmail(email)) {
      const allowed = this.orgRegistry.list().map((org) => org.domain).join(', ');
      throw new Error(`Email domain not allowed: ${email}. Allowed domains: ${allowed}`);
    }
    this.loginOverride = { email, password };
  }

  /** The active credentials, or a helpful error when nothing is configured. */
  credentials(): MailCredentials {
    if (this.loginOverride) {
      return this.loginOverride;
    }

    const email = process.env.BMAIL_MCP_EMAIL;
    const password = process.env.BMAIL_MCP_PASSWORD;

    if (!email || !password) {
      throw new Error(
        'No mail credentials: set BMAIL_MCP_EMAIL and BMAIL_MCP_PASSWORD in the ' +
          'MCP server environment, or call mail_login first.',
      );
    }

    return { email, password };
  }

  /**
   * Run one operation against a fresh IMAP connection for the active user.
   * The connection is always closed, even when the operation throws.
   */
  async withImap<T>(operation: (imap: ImapService) => Promise<T>): Promise<T> {
    const { email, password } = this.credentials();
    const account = buildAccountConfig(this.orgRegistry, email, password);
    const imap = new ImapService(account);

    await imap.connect();
    try {
      return await operation(imap);
    } finally {
      await imap.disconnect();
    }
  }
}
