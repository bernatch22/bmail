/**
 * mail-service.ts — The message operations the HTTP routes used to inline.
 *
 * In bermail, route-messages.ts repeated the same choreography per endpoint
 * (IMAP action + mirror the change in the local store): trash alone was
 * spelled out six times across handlers. Each of those sequences is now ONE
 * method here, so apps/server routes shrink to parse-params → call → respond.
 *
 * One MailService per logged-in user: it wraps that user's SyncEngine (and
 * through it, their ImapService) plus the shared repository.
 */

import type { AttachmentInfo, FullMessage, PaginatedMessages } from '@bmail/contract';
import type { MailRepository } from '@bmail/db/repository';

import type { SyncEngine } from './sync-engine.js';
import type { AttachmentContent } from './imap-service.js';

export class MailService {
  private readonly repository: MailRepository;
  private readonly sync: SyncEngine;
  private readonly accountId: string;

  constructor(repository: MailRepository, sync: SyncEngine, accountId: string) {
    this.repository = repository;
    this.sync = sync;
    this.accountId = accountId;
  }

  // ─── Reading ─────────────────────────────────────────

  /** List messages for a folder page. 100% local store — no IMAP round-trip. */
  listMessages(folder: string, limit: number = 30, page: number = 1): PaginatedMessages {
    const result = this.repository.getMessages(this.accountId, folder, limit, page);
    return {
      data: result.messages,
      total: result.total,
      page,
      pageSize: limit,
    };
  }

  /**
   * Get a single full message: local store first, lazy body fetch from IMAP
   * when the body is missing, marked seen on open. When the message carries
   * attachments, their metadata is fetched live from IMAP (the local store
   * does not persist it yet — see the optimization note in ImapService).
   */
  async getMessage(folder: string, uid: number): Promise<FullMessage | null> {
    let message = this.repository.getMessage(this.accountId, folder, uid);

    // Row exists but the body was never pulled → fetch and re-read.
    if (message && !message.htmlBody && !message.textBody) {
      await this.sync.fetchBody(folder, uid);
      message = this.repository.getMessage(this.accountId, folder, uid);
    }

    // Row missing entirely (e.g. very fresh mail) → same recovery path.
    if (!message) {
      await this.sync.fetchBody(folder, uid);
      message = this.repository.getMessage(this.accountId, folder, uid);
    }

    if (!message) {
      return null;
    }

    // Opening a message marks it read locally (IMAP side was already marked
    // by the body fetch, or will be by an explicit markSeen call).
    if (!message.seen) {
      const folderId = this.repository.getFolderId(this.accountId, folder);
      if (folderId) {
        this.repository.markAsSeen(folderId, uid);
      }
      message.seen = true;
    }

    // Attachments metadata (step 11): enrich from IMAP when flagged.
    if (message.hasAttachments) {
      try {
        message.attachments = await this.getAttachmentList(folder, uid);
      } catch {
        // A failed metadata fetch must not hide the message itself.
        message.attachments = [];
      }
    }

    return message;
  }

  // ─── Attachments ─────────────────────────────────────

  /** Attachment descriptors for one message (no flag changes). */
  async getAttachmentList(folder: string, uid: number): Promise<AttachmentInfo[]> {
    return this.sync.imap.getAttachmentList(folder, uid);
  }

  /**
   * One attachment's bytes, ready to stream over HTTP. `partId` comes from
   * the AttachmentInfo previously returned by getMessage.
   */
  async getAttachment(
    folder: string,
    uid: number,
    partId: string,
  ): Promise<AttachmentContent | null> {
    return this.sync.imap.getAttachment(folder, uid, partId);
  }

  // ─── Flags ───────────────────────────────────────────

  async markSeen(folder: string, uid: number): Promise<void> {
    await this.sync.imap.markSeen(folder, uid);
    this.mirrorSeen(folder, uid, true);
  }

  async markUnseen(folder: string, uid: number): Promise<void> {
    await this.sync.imap.markUnseen(folder, uid);
    this.mirrorSeen(folder, uid, false);
  }

  async flag(folder: string, uid: number): Promise<void> {
    await this.sync.imap.flagMessage(folder, uid);
  }

  async unflag(folder: string, uid: number): Promise<void> {
    await this.sync.imap.unflagMessage(folder, uid);
  }

  // ─── Moving and deleting ─────────────────────────────

  /** Move a message to another folder and drop the stale local row. */
  async move(folder: string, uid: number, destFolder: string): Promise<void> {
    await this.sync.imap.moveMessage(folder, uid, destFolder);
    this.removeLocalRow(folder, uid);
  }

  /** Move to Trash. THE sequence route-messages.ts wrote out six times. */
  async trash(folder: string, uid: number): Promise<void> {
    await this.sync.imap.deleteMessage(folder, uid);
    this.removeLocalRow(folder, uid);
  }

  /** Move to Archive. */
  async archive(folder: string, uid: number): Promise<void> {
    await this.move(folder, uid, 'Archive');
  }

  /**
   * Remove the local cache row for a message. The IMAP copy is untouched —
   * use trash()/move() for user-facing deletion.
   */
  delete(folder: string, uid: number): void {
    this.removeLocalRow(folder, uid);
  }

  // ─── Local mirroring helpers ─────────────────────────

  private mirrorSeen(folder: string, uid: number, seen: boolean): void {
    const folderId = this.repository.getFolderId(this.accountId, folder);
    if (!folderId) {
      return;
    }
    if (seen) {
      this.repository.markAsSeen(folderId, uid);
    } else {
      this.repository.markAsUnseen(folderId, uid);
    }
  }

  private removeLocalRow(folder: string, uid: number): void {
    const folderId = this.repository.getFolderId(this.accountId, folder);
    if (folderId) {
      this.repository.deleteMessage(folderId, uid);
    }
  }
}
