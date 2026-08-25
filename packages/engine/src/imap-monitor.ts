/**
 * imap-monitor.ts — IMAP IDLE monitor.
 *
 * Dedicated IMAP connection kept in IDLE to detect new mail in real time.
 * Fires events when the mailbox gains messages. Auto-reconnects with backoff.
 *
 * NOTE: we open the mailbox with `mailboxOpen` and do NOT hold a
 * `getMailboxLock` — holding a lock keeps the connection "busy" and prevents
 * imapflow from entering IDLE, so the 'exists' event never fires. That was
 * the bug that made new mail invisible until a full restart.
 */

import { ImapFlow } from 'imapflow';

import type { AccountConfig } from './org-registry.js';

// ─── Event shapes ──────────────────────────────────────

/** ImapFlow 'exists' event shape — typed at the boundary. */
interface ImapExistsData {
  path: string;
  count: number;
  prevCount: number;
}

export interface MailEvent {
  type: 'new_message';
  folder: string;
  count: number;
  previousCount: number;
}

export type MailEventListener = (event: MailEvent) => void;

// ─── Monitor ───────────────────────────────────────────

const MAX_MONITOR_RECONNECT_ATTEMPTS = 15;

export class ImapMonitor {
  private readonly account: AccountConfig;
  private readonly accessToken: string;
  private client!: ImapFlow;
  private folder = 'INBOX';
  private readonly listeners: Set<MailEventListener> = new Set();
  private running = false;
  private reconnecting = false;
  private attempts = 0;

  constructor(account: AccountConfig, accessToken = '') {
    this.account = account;
    this.accessToken = accessToken;
  }

  private makeClient(): void {
    this.client = new ImapFlow({
      host: this.account.imap.host,
      port: this.account.imap.port,
      secure: this.account.imap.secure,
      auth: this.account.oauth
        ? { user: this.account.user, accessToken: this.accessToken }
        : { user: this.account.user, pass: this.account.pass },
      logger: false,
    });

    this.client.on('exists', (data: ImapExistsData) => {
      const event: MailEvent = {
        type: 'new_message',
        folder: data.path,
        count: data.count,
        previousCount: data.prevCount,
      };
      for (const listener of this.listeners) {
        listener(event);
      }
    });

    this.client.on('close', () => {
      if (this.running) {
        this.reconnect();
      }
    });
    this.client.on('error', () => {
      if (this.running) {
        this.reconnect();
      }
    });
  }

  async start(folder: string = 'INBOX'): Promise<void> {
    this.folder = folder;
    this.makeClient();
    await this.client.connect();

    // Open, do NOT lock → the connection stays free to enter IDLE.
    await this.client.mailboxOpen(folder);

    this.running = true;
    this.attempts = 0;
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting || !this.running) {
      return;
    }
    this.reconnecting = true;

    while (this.running && this.attempts < MAX_MONITOR_RECONNECT_ATTEMPTS) {
      this.attempts++;
      const delay = Math.min(1000 * 2 ** (this.attempts - 1), 30000);
      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        this.makeClient();
        await this.client.connect();
        await this.client.mailboxOpen(this.folder);
        this.attempts = 0;
        this.reconnecting = false;
        console.log('  ✓ IMAP monitor reconnected');
        return;
      } catch {
        // Keep retrying with backoff.
      }
    }

    this.reconnecting = false;
  }

  /** Subscribe to new-mail events. Returns an unsubscribe function. */
  onEvent(listener: MailEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    try {
      await this.client.logout();
    } catch {
      // Connection may already be closed during shutdown.
    }
  }
}
