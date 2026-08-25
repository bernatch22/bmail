/**
 * imap-service.ts — Per-user IMAP connection.
 *
 * Wraps imapflow for listing mailboxes, listing messages, reading bodies,
 * flag/move actions and appending the Sent copy. Includes auto-reconnect
 * with exponential backoff.
 *
 * Types note: this class speaks IMAP, so its envelope keeps `date` as a
 * real `Date`. The wire types in @bmail/contract use ISO strings; SyncEngine
 * converts at the boundary when it writes rows into the repository.
 *
 * Attachments (migration step 11): attachment metadata is extracted with
 * mailparser when a full message is read. `partId` is the 1-based index of
 * the attachment within the parsed message — mailparser does not expose IMAP
 * BODYSTRUCTURE part numbers, and since fetching bytes re-parses the same
 * source, an index into `parsed.attachments` is a stable, sufficient handle.
 */

import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';

import type { AttachmentInfo } from '@bmail/contract';
import type { AccountConfig } from './org-registry.js';

// ─── Engine-internal message shapes ────────────────────

export interface ImapMailboxInfo {
  path: string;
  name: string;
  messages: number;
  unseen: number;
}

export interface ImapMessageEnvelope {
  uid: number;
  seq: number;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: Date | undefined;
  seen: boolean;
  hasAttachments: boolean;
  messageId?: string;
  inReplyTo?: string;
}

export interface ImapFullMessage extends ImapMessageEnvelope {
  textBody: string;
  htmlBody: string;
  attachments: AttachmentInfo[];
}

/** One attachment's bytes plus enough metadata to serve it over HTTP. */
export interface AttachmentContent {
  filename: string;
  contentType: string;
  content: Buffer;
}

// ─── Service ───────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 1000;

export class ImapService {
  private client!: ImapFlow;
  private readonly account: AccountConfig;
  private readonly accessToken: string;
  private connected = false;
  private reconnecting = false;
  private reconnectAttempts = 0;

  constructor(account: AccountConfig, accessToken = '') {
    this.account = account;
    this.accessToken = accessToken;
    this.createClient();
  }

  // ─── Connection lifecycle ────────────────────────────

  private createClient(): void {
    this.client = new ImapFlow({
      host: this.account.imap.host,
      port: this.account.imap.port,
      secure: this.account.imap.secure,
      auth: this.account.oauth
        ? { user: this.account.user, accessToken: this.accessToken }
        : { user: this.account.user, pass: this.account.pass },
      logger: false,
    });

    // Auto-reconnect on close/error while we believe we are connected.
    this.client.on('close', () => {
      if (this.connected) {
        console.log('  ⚠ IMAP connection closed — reconnecting...');
        this.connected = false;
        this.reconnect();
      }
    });

    this.client.on('error', (err: Error) => {
      console.error('  ✗ IMAP error:', err.message);
      if (this.connected) {
        this.connected = false;
        this.reconnect();
      }
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.connected = true;
    this.reconnectAttempts = 0;
    console.log('  ✓ IMAP connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.reconnecting = false;
    try {
      await this.client.logout();
    } catch {
      // Ignore logout errors during shutdown.
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) {
      return;
    }
    this.reconnecting = true;

    while (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
        30000,
      );
      console.log(
        `  ↻ Reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        this.createClient();
        await this.client.connect();
        this.connected = true;
        this.reconnectAttempts = 0;
        this.reconnecting = false;
        console.log('  ✓ IMAP reconnected');
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Reconnect failed: ${message}`);
      }
    }

    this.reconnecting = false;
    console.error(`  ✗ Max reconnect attempts reached (${MAX_RECONNECT_ATTEMPTS}). Giving up.`);
  }

  /** Ensures the connection is alive before any operation. */
  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }

    // Try reconnecting once, synchronously with the caller.
    try {
      this.createClient();
      await this.client.connect();
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log('  ✓ IMAP reconnected (on-demand)');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Connection not available: ${message}`);
    }
  }

  // ─── Mailboxes ───────────────────────────────────────

  /** List all mailboxes (folders) with message counts. */
  async listMailboxes(): Promise<ImapMailboxInfo[]> {
    await this.ensureConnected();
    const mailboxes: ImapMailboxInfo[] = [];
    const list = await this.client.list();

    for (const mailbox of list) {
      try {
        const status = await this.client.status(mailbox.path, {
          messages: true,
          unseen: true,
        });
        mailboxes.push({
          path: mailbox.path,
          name: mailbox.name,
          messages: status.messages ?? 0,
          unseen: status.unseen ?? 0,
        });
      } catch {
        // Some special folders may not support STATUS.
        mailboxes.push({
          path: mailbox.path,
          name: mailbox.name,
          messages: 0,
          unseen: 0,
        });
      }
    }

    return mailboxes;
  }

  // ─── Listing messages ────────────────────────────────

  /**
   * List message envelopes in a folder with pagination. Newest first.
   */
  async listMessages(
    folder: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ messages: ImapMessageEnvelope[]; total: number }> {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock(folder);

    try {
      const mailbox = this.client.mailbox;
      const total =
        mailbox && typeof mailbox === 'object' && 'exists' in mailbox ? mailbox.exists : 0;

      if (total === 0) {
        return { messages: [], total: 0 };
      }

      // Calculate the sequence range for this page (newest first).
      const end = total - (page - 1) * limit;
      const start = Math.max(1, end - limit + 1);

      if (end <= 0) {
        return { messages: [], total };
      }

      const range = `${start}:${end}`;
      const messages: ImapMessageEnvelope[] = [];

      for await (const msg of this.client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      })) {
        messages.push(this.buildEnvelope(msg));
      }

      // Newest first for the UI.
      messages.sort((a, b) => b.seq - a.seq);

      return { messages, total };
    } finally {
      lock.release();
    }
  }

  /**
   * Fetch envelopes for messages strictly NEWER than `sinceUid`, using an
   * active server-side UID SEARCH (not the cached mailbox `exists` count —
   * that goes stale on a long-lived connection and misses new mail).
   */
  async fetchSince(folder: string, sinceUid: number): Promise<ImapMessageEnvelope[]> {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock(folder);

    try {
      // On a long-lived, already-selected mailbox the server does NOT surface
      // newly-arrived messages until the client polls — a bare SEARCH runs
      // against the stale session view and misses them. NOOP forces the
      // server to flush pending EXISTS so the following SEARCH sees new UIDs.
      await this.client.noop();

      // `n:*` matches the last message even when n > max UID (IMAP quirk),
      // so filter strictly > sinceUid to get a real empty when nothing is new.
      const uids = (await this.client.search({ uid: `${sinceUid + 1}:*` }, { uid: true })) || [];
      const fresh = uids.filter((uid: number) => uid > sinceUid);
      if (fresh.length === 0) {
        return [];
      }

      const messages: ImapMessageEnvelope[] = [];
      for await (const msg of this.client.fetch(
        fresh,
        { uid: true, envelope: true, flags: true, bodyStructure: true },
        { uid: true },
      )) {
        messages.push(this.buildEnvelope(msg));
      }
      messages.sort((a, b) => b.uid - a.uid);
      return messages;
    } finally {
      lock.release();
    }
  }

  /** Build an engine envelope from an imapflow fetch result. */
  private buildEnvelope(msg: any): ImapMessageEnvelope {
    return {
      uid: msg.uid,
      seq: msg.seq,
      subject: msg.envelope?.subject ?? '(no subject)',
      from: formatAddress(msg.envelope?.from?.[0]),
      to: formatAddressList(msg.envelope?.to),
      cc: formatAddressList(msg.envelope?.cc),
      date: msg.envelope?.date,
      seen: msg.flags?.has('\\Seen') ?? false,
      hasAttachments: structureHasAttachments(msg.bodyStructure),
      messageId: msg.envelope?.messageId ?? undefined,
      inReplyTo: msg.envelope?.inReplyTo ?? undefined,
    };
  }

  // ─── Full message + attachments ──────────────────────

  /**
   * Fetch a full message by UID, including bodies and attachment metadata,
   * and mark it as read (opening a message means reading it).
   */
  async getMessage(folder: string, uid: number): Promise<ImapFullMessage | null> {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock(folder);

    try {
      const msg = await this.client.fetchOne(
        String(uid),
        {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          source: true,
        },
        { uid: true },
      );

      if (!msg) {
        return null;
      }

      // Parse the raw source to extract bodies and attachment metadata.
      let textBody = '';
      let htmlBody = '';
      let attachments: AttachmentInfo[] = [];

      if (msg.source) {
        const parsed = await simpleParser(msg.source);
        textBody = parsed.text ?? '';
        htmlBody = (parsed.html as string) || '';
        attachments = attachmentInfosFrom(parsed);
      }

      // Opening the message marks it read on the server.
      await this.client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });

      return {
        uid: msg.uid,
        seq: msg.seq,
        subject: msg.envelope?.subject ?? '(no subject)',
        from: formatAddress(msg.envelope?.from?.[0]),
        to: formatAddressList(msg.envelope?.to),
        cc: formatAddressList(msg.envelope?.cc),
        date: msg.envelope?.date,
        seen: true,
        hasAttachments: structureHasAttachments(msg.bodyStructure),
        messageId: msg.envelope?.messageId ?? undefined,
        inReplyTo: msg.envelope?.inReplyTo ?? undefined,
        textBody,
        htmlBody,
        attachments,
      };
    } finally {
      lock.release();
    }
  }

  /**
   * List the attachments of a message WITHOUT touching its flags.
   * Used to enrich a cached message read from the local store.
   *
   * Optimization note: this re-downloads and re-parses the full source.
   * Good enough for now; if it ever shows up in profiles, persist the
   * attachment metadata in the repository at body-fetch time instead.
   */
  async getAttachmentList(folder: string, uid: number): Promise<AttachmentInfo[]> {
    const parsed = await this.fetchAndParse(folder, uid);
    if (!parsed) {
      return [];
    }
    return attachmentInfosFrom(parsed);
  }

  /**
   * Fetch one attachment's bytes by its partId (1-based index into the
   * parsed attachment list — see the header comment). Returns null when the
   * message or the part does not exist.
   */
  async getAttachment(
    folder: string,
    uid: number,
    partId: string,
  ): Promise<AttachmentContent | null> {
    const parsed = await this.fetchAndParse(folder, uid);
    if (!parsed) {
      return null;
    }

    const index = Number.parseInt(partId, 10);
    if (Number.isNaN(index) || index < 1) {
      return null;
    }

    const attachment = (parsed.attachments ?? [])[index - 1];
    if (!attachment) {
      return null;
    }

    return {
      filename: attachment.filename || `attachment-${index}`,
      contentType: attachment.contentType || 'application/octet-stream',
      content: attachment.content,
    };
  }

  /** Download and parse a message's raw source without changing its flags. */
  private async fetchAndParse(folder: string, uid: number): Promise<ParsedMail | null> {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock(folder);

    try {
      const msg = await this.client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!msg || !msg.source) {
        return null;
      }
      return await simpleParser(msg.source);
    } finally {
      lock.release();
    }
  }

  // ─── Message actions ─────────────────────────────────

  async moveMessage(folder: string, uid: number, destFolder: string): Promise<void> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      await this.client.messageMove(String(uid), destFolder, { uid: true });
    } finally {
      lock.release();
    }
  }

  /** Move to Trash instead of a permanent delete. */
  async deleteMessage(folder: string, uid: number): Promise<void> {
    await this.moveMessage(folder, uid, 'Trash');
  }

  async flagMessage(folder: string, uid: number): Promise<void> {
    await this.changeFlags(folder, uid, 'add', ['\\Flagged']);
  }

  async unflagMessage(folder: string, uid: number): Promise<void> {
    await this.changeFlags(folder, uid, 'remove', ['\\Flagged']);
  }

  async markSeen(folder: string, uid: number): Promise<void> {
    await this.changeFlags(folder, uid, 'add', ['\\Seen']);
  }

  async markUnseen(folder: string, uid: number): Promise<void> {
    await this.changeFlags(folder, uid, 'remove', ['\\Seen']);
  }

  private async changeFlags(
    folder: string,
    uid: number,
    action: 'add' | 'remove',
    flags: string[],
  ): Promise<void> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      if (action === 'add') {
        await this.client.messageFlagsAdd(String(uid), flags, { uid: true });
      } else {
        await this.client.messageFlagsRemove(String(uid), flags, { uid: true });
      }
    } finally {
      lock.release();
    }
  }

  // ─── Sent copy ───────────────────────────────────────

  /** Best-effort: save a copy of a sent message to the Sent folder. */
  async appendToSent(raw: Buffer | string): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client.append('Sent', raw, ['\\Seen']);
    } catch (err: unknown) {
      console.error('  ⚠ append to Sent failed:', err instanceof Error ? err.message : err);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────

/** Render one imapflow address object as "Name <addr>" (or just the addr). */
function formatAddress(address: { name?: string; address?: string } | undefined): string {
  if (!address) {
    return 'unknown';
  }
  if (address.name) {
    return `${address.name} <${address.address}>`;
  }
  return address.address ?? 'unknown';
}

/** Render an imapflow address list as a comma-separated string. */
function formatAddressList(addresses: { name?: string; address?: string }[] | undefined): string {
  return (addresses ?? [])
    .map((address) =>
      address.name ? `${address.name} <${address.address}>` : address.address ?? '',
    )
    .join(', ');
}

/** Check whether a BODYSTRUCTURE tree contains an attachment part. */
function structureHasAttachments(structure: any): boolean {
  if (!structure) {
    return false;
  }
  if (structure.disposition === 'attachment') {
    return true;
  }
  if (structure.childNodes) {
    return structure.childNodes.some((child: any) => structureHasAttachments(child));
  }
  return false;
}

/** Map mailparser attachments to the wire AttachmentInfo (1-based partId). */
function attachmentInfosFrom(parsed: ParsedMail): AttachmentInfo[] {
  return (parsed.attachments ?? []).map((attachment, index) => ({
    filename: attachment.filename || `attachment-${index + 1}`,
    contentType: attachment.contentType || 'application/octet-stream',
    size: attachment.size ?? attachment.content?.length ?? 0,
    partId: String(index + 1),
  }));
}
