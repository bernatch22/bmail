/**
 * repository.ts — Typed query layer over one open BmailDatabase.
 *
 * Migrated from bermail's @shmail/db. Two deliberate changes, zero logic
 * changes:
 *   1. The connection is injected: construct `new MailRepository(database)`
 *     with a handle from createDatabase() — no module-level singleton.
 *   2. The wire types (MailboxInfo, MessageEnvelope, FullMessage) come from
 *     ../types instead of being declared here.
 *
 * The FTS5 + threading behavior (JWZ-inspired computeThreadId, subject
 * grouping, cross-folder thread assembly) is kept intact from bermail.
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import type { MailboxInfo, MessageEnvelope, FullMessage } from '../types/index.js';
import type { BmailDatabase } from './database.js';
import { normalizeSubject } from '../logic/threading.js';
import * as schema from './schema.js';

const { accounts, folders, messages } = schema;

// Convenience re-export so callers can type their variables from one place.
export type { MailboxInfo, MessageEnvelope, FullMessage };

// ─── Pure helpers ──────────────────────────────────────

// Threading lives in ../logic: one implementation, unit-tested there. The
// re-export keeps store consumers from reaching across folders for it.
export { normalizeSubject };

// ─── Repository ────────────────────────────────────────

export class MailRepository {
  private readonly database: BmailDatabase;

  constructor(database: BmailDatabase) {
    this.database = database;
  }

  // Short accessors: `db` is the typed Drizzle facade, `raw` the underlying
  // better-sqlite3 connection (needed for FTS5 and dynamic IN (...) lists).
  private get db() {
    return this.database.drizzle;
  }

  private get raw() {
    return this.database.sqlite;
  }

  // ─── Accounts ────────────────────────────────────────

  upsertAccount(id: string, label: string, email: string): void {
    this.db.insert(accounts)
      .values({ id, label, email })
      .onConflictDoUpdate({
        target: accounts.id,
        set: { label, email },
      })
      .run();
  }

  // ─── Folders ─────────────────────────────────────────

  getFolders(accountId: string): MailboxInfo[] {
    const rows = this.db
      .select({
        path: folders.path,
        name: folders.name,
        messages: folders.totalMessages,
        unseen: folders.unseenCount,
        folderId: folders.id,
      })
      .from(folders)
      .where(eq(folders.accountId, accountId))
      .all();

    // Compute unseen from actual messages (ground truth), not the cached
    // counter — the counter drifts when messages are marked read locally.
    return rows.map((row) => {
      const unseenRow = this.db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(and(eq(messages.folderId, row.folderId), eq(messages.seen, false)))
        .get();

      return {
        path: row.path,
        name: row.name,
        messages: row.messages ?? 0,
        unseen: unseenRow?.count ?? 0,
      };
    });
  }

  upsertFolder(
    accountId: string,
    path: string,
    name: string,
    totalMessages: number,
    unseenCount: number,
  ): number {
    this.db.insert(folders)
      .values({
        accountId,
        path,
        name,
        totalMessages,
        unseenCount,
        lastSyncedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [folders.accountId, folders.path],
        set: {
          name,
          totalMessages,
          unseenCount,
          lastSyncedAt: new Date().toISOString(),
        },
      })
      .run();

    // The upsert does not return the id; fetch it explicitly.
    const row = this.db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.accountId, accountId), eq(folders.path, path)))
      .get();

    return row!.id;
  }

  getFolderId(accountId: string, folderPath: string): number | null {
    const row = this.db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.accountId, accountId), eq(folders.path, folderPath)))
      .get();

    return row?.id ?? null;
  }

  // ─── Messages: reading ───────────────────────────────

  getMessages(
    accountId: string,
    folderPath: string,
    limit: number = 30,
    page: number = 1,
  ): { messages: MessageEnvelope[]; total: number } {
    const folderId = this.getFolderId(accountId, folderPath);
    if (!folderId) {
      return { messages: [], total: 0 };
    }

    const offset = (page - 1) * limit;

    // Count total for pagination.
    const countRow = this.db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.folderId, folderId))
      .get();
    const total = countRow?.count ?? 0;

    // Fetch page (newest first).
    const rows = this.db
      .select({
        uid: messages.uid,
        subject: messages.subject,
        from: messages.fromAddress,
        date: messages.date,
        seen: messages.seen,
        hasAttachments: messages.hasAttachments,
        preview: messages.preview,
        threadId: messages.threadId,
        aiInsight: messages.aiInsight,
      })
      .from(messages)
      .where(eq(messages.folderId, folderId))
      .orderBy(desc(messages.date))
      .limit(limit)
      .offset(offset)
      .all();

    const mapRow = (row: typeof rows[0]): MessageEnvelope => ({
      uid: row.uid,
      seq: 0,
      subject: row.subject,
      from: row.from,
      date: row.date,
      seen: row.seen ?? false,
      hasAttachments: row.hasAttachments ?? false,
      preview: row.preview ?? undefined,
      threadId: row.threadId,
      aiInsight: row.aiInsight ?? undefined,
      folder: folderPath,
    });

    const folderMessages = rows.map(mapRow);

    // Collect unique threadIds from this page, to pull in the sent copies
    // living in other folders (Gmail-style conversation rows in the list).
    const threadIds = [...new Set(rows.map((row) => row.threadId).filter(Boolean))];
    if (threadIds.length === 0) {
      return { messages: folderMessages, total };
    }

    // Dynamic IN (...) list → raw SQL (Drizzle cannot bind a variable list here).
    const placeholders = threadIds.map(() => '?').join(',');
    const sentRows = this.raw.prepare(
      `SELECT uid, subject, from_address, date, seen, has_attachments, preview, thread_id, ai_insight
       FROM messages
       WHERE folder_id != ? AND thread_id IN (${placeholders})
       ORDER BY date ASC`
    ).all(folderId, ...threadIds) as any[];

    const sentMessages: MessageEnvelope[] = sentRows.map((row: any) => ({
      uid: row.uid,
      seq: 0,
      subject: row.subject,
      from: row.from_address,
      date: row.date,
      seen: row.seen ? true : false,
      hasAttachments: row.has_attachments ? true : false,
      preview: row.preview ?? undefined,
      threadId: row.thread_id,
      aiInsight: row.ai_insight ?? undefined,
      folder: '__sent__',
    }));

    return {
      messages: [...folderMessages, ...sentMessages],
      total,
    };
  }

  getMessage(
    accountId: string,
    folderPath: string,
    uid: number,
  ): FullMessage | null {
    const folderId = this.getFolderId(accountId, folderPath);
    if (!folderId) {
      return null;
    }

    const row = this.db
      .select()
      .from(messages)
      .where(and(eq(messages.folderId, folderId), eq(messages.uid, uid)))
      .get();

    if (!row) {
      return null;
    }

    return {
      uid: row.uid,
      seq: 0,
      subject: row.subject,
      from: row.fromAddress,
      to: row.toAddresses ?? '',
      cc: row.ccAddresses ?? '',
      messageId: row.messageId ?? null,
      date: row.date,
      seen: row.seen ?? false,
      hasAttachments: row.hasAttachments ?? false,
      textBody: row.textBody ?? '',
      htmlBody: row.htmlBody ?? '',
      threadId: row.threadId ?? '',
    };
  }

  /**
   * Get all messages in a thread across ALL folders (INBOX + Sent Items…).
   * Used for the Gmail-style conversation view.
   */
  getThreadMessages(accountId: string, threadId: string): FullMessage[] {
    const accountFolders = this.db
      .select({ id: folders.id, path: folders.path })
      .from(folders)
      .where(eq(folders.accountId, accountId))
      .all();

    if (accountFolders.length === 0) {
      return [];
    }

    const folderIds = accountFolders.map((folder) => folder.id);
    const folderPathById = new Map(accountFolders.map((folder) => [folder.id, folder.path]));

    // Dynamic IN (...) list again → raw SQL.
    const placeholders = folderIds.map(() => '?').join(',');
    const rows = this.raw.prepare(
      `SELECT * FROM messages WHERE folder_id IN (${placeholders}) AND thread_id = ? ORDER BY date ASC`
    ).all(...folderIds, threadId) as any[];

    return rows.map((row: any) => ({
      uid: row.uid,
      seq: 0,
      subject: row.subject,
      from: row.from_address,
      to: row.to_addresses ?? '',
      cc: row.cc_addresses ?? '',
      messageId: row.message_id ?? null,
      date: row.date,
      seen: row.seen ? true : false,
      hasAttachments: row.has_attachments ? true : false,
      textBody: row.text_body ?? '',
      htmlBody: row.html_body ?? '',
      threadId: row.thread_id ?? '',
      aiInsight: row.ai_insight ?? undefined,
      folder: folderPathById.get(row.folder_id),
    }));
  }

  // ─── Messages: writing ───────────────────────────────

  upsertMessage(
    accountId: string,
    folderId: number,
    msg: {
      uid: number;
      messageId?: string;
      inReplyTo?: string;
      subject: string;
      from: string;
      to?: string;
      cc?: string;
      date?: string;
      seen: boolean;
      hasAttachments: boolean;
      preview?: string;
      textBody?: string;
      htmlBody?: string;
    },
  ): void {
    const now = new Date().toISOString();
    const threadId = this.computeThreadId(accountId, msg.messageId, msg.inReplyTo, msg.subject);

    this.db.insert(messages)
      .values({
        accountId,
        folderId,
        uid: msg.uid,
        messageId: msg.messageId ?? null,
        inReplyTo: msg.inReplyTo ?? null,
        threadId,
        subject: msg.subject,
        fromAddress: msg.from,
        toAddresses: msg.to ?? '',
        ccAddresses: msg.cc ?? '',
        date: msg.date ?? null,
        seen: msg.seen,
        hasAttachments: msg.hasAttachments,
        preview: msg.preview ?? '',
        textBody: msg.textBody ?? '',
        htmlBody: msg.htmlBody ?? '',
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: [messages.folderId, messages.uid],
        set: {
          messageId: msg.messageId ?? null,
          inReplyTo: msg.inReplyTo ?? null,
          threadId,
          subject: msg.subject,
          fromAddress: msg.from,
          toAddresses: msg.to ?? '',
          ccAddresses: msg.cc ?? '',
          // Only set seen to true, never revert to false — a local read
          // takes priority over a stale IMAP flag.
          ...(msg.seen ? { seen: true } : {}),
          hasAttachments: msg.hasAttachments,
          preview: msg.preview ?? '',
          ...(msg.textBody ? { textBody: msg.textBody } : {}),
          ...(msg.htmlBody ? { htmlBody: msg.htmlBody } : {}),
          syncedAt: now,
        },
      })
      .run();
  }

  /**
   * JWZ-inspired hybrid threading:
   *
   * Phase 1: In-Reply-To → find parent by Message-ID → join parent's thread
   * Phase 2: Subject grouping (for Re:/Fwd: without In-Reply-To, e.g. Outlook
   *          sent copies) → find existing thread with same normalized subject
   * Phase 3: New thread → own Message-ID as threadId
   *
   * Key: only "Re:"/"Fwd:" messages trigger subject matching. A new email
   * "Hello bro" will NEVER match an old "Hello bro" unless it has a Re: prefix.
   */
  private computeThreadId(
    accountId: string,
    messageId?: string,
    inReplyTo?: string,
    subject?: string,
  ): string {
    // Phase 1: In-Reply-To header lookup (most reliable, RFC 5322).
    if (inReplyTo) {
      const parent = this.raw.prepare(
        'SELECT thread_id FROM messages WHERE account_id = ? AND message_id = ? LIMIT 1'
      ).get(accountId, inReplyTo) as { thread_id: string } | undefined;

      if (parent?.thread_id) {
        return parent.thread_id;
      }
    }

    // Phase 2: Subject grouping — ONLY for replies/forwards without In-Reply-To.
    const isReply = /^(re|fwd|fw)\s*:/i.test(subject ?? '');
    if (isReply) {
      const normalized = normalizeSubject(subject ?? '');
      if (normalized) {
        // Scan the account's messages for one whose normalized subject
        // matches. This handles Outlook sent copies that lack In-Reply-To.
        const rows = this.raw.prepare(
          `SELECT thread_id, subject FROM messages
           WHERE account_id = ? AND message_id != ? AND message_id IS NOT NULL
           ORDER BY date ASC`
        ).all(accountId, messageId ?? '') as { thread_id: string; subject: string }[];

        for (const row of rows) {
          if (normalizeSubject(row.subject) === normalized) {
            return row.thread_id;
          }
        }
      }
    }

    // Phase 3: New thread — own Message-ID (globally unique, won't collide).
    if (messageId) {
      return messageId;
    }

    // Absolute fallback for messages without any headers.
    return normalizeSubject(subject ?? '');
  }

  updateMessageBody(
    folderId: number,
    uid: number,
    textBody: string,
    htmlBody: string,
    to?: string,
    cc?: string,
  ): void {
    this.db.update(messages)
      .set({
        textBody,
        htmlBody,
        ...(to !== undefined ? { toAddresses: to } : {}),
        ...(cc !== undefined ? { ccAddresses: cc } : {}),
        syncedAt: new Date().toISOString(),
      })
      .where(and(eq(messages.folderId, folderId), eq(messages.uid, uid)))
      .run();
  }

  hasMessageBody(folderId: number, uid: number): boolean {
    const row = this.db
      .select({ htmlBody: messages.htmlBody, textBody: messages.textBody })
      .from(messages)
      .where(and(eq(messages.folderId, folderId), eq(messages.uid, uid)))
      .get();

    return !!(row && (row.htmlBody || row.textBody));
  }

  markAsSeen(folderId: number, uid: number): void {
    this.db.update(messages)
      .set({ seen: true })
      .where(and(eq(messages.folderId, folderId), eq(messages.uid, uid)))
      .run();
  }

  markAsUnseen(folderId: number, uid: number): void {
    this.db.update(messages)
      .set({ seen: false })
      .where(and(eq(messages.folderId, folderId), eq(messages.uid, uid)))
      .run();
  }

  deleteMessage(folderId: number, uid: number): void {
    this.db.delete(messages)
      .where(and(eq(messages.folderId, folderId), eq(messages.uid, uid)))
      .run();
  }

  // ─── AI insights ─────────────────────────────────────

  updateAiInsight(folderId: number, uid: number, insight: string): void {
    this.db.update(messages)
      .set({ aiInsight: insight, aiProcessed: true })
      .where(and(eq(messages.folderId, folderId), eq(messages.uid, uid)))
      .run();
  }

  getUnprocessedMessages(accountId: string, limit: number = 10): {
    folderId: number;
    uid: number;
    subject: string;
    from: string;
    textBody: string;
    htmlBody: string;
    folderPath: string;
  }[] {
    return this.db
      .select({
        folderId: messages.folderId,
        uid: messages.uid,
        subject: messages.subject,
        from: messages.fromAddress,
        textBody: messages.textBody,
        htmlBody: messages.htmlBody,
        folderPath: folders.path,
      })
      .from(messages)
      .innerJoin(folders, eq(messages.folderId, folders.id))
      .where(
        and(
          eq(messages.accountId, accountId),
          eq(messages.aiProcessed, false),
          sql`(${messages.textBody} != '' OR ${messages.htmlBody} != '')`,
        ),
      )
      .orderBy(desc(messages.date))
      .limit(limit)
      .all() as any[];
  }

  // ─── Sync helpers ────────────────────────────────────

  getHighestUid(folderId: number): number {
    const row = this.db
      .select({ maxUid: sql<number>`MAX(uid)` })
      .from(messages)
      .where(eq(messages.folderId, folderId))
      .get();

    return row?.maxUid ?? 0;
  }

  // ─── Search (FTS5) ───────────────────────────────────

  searchMessages(
    accountId: string,
    query: string,
    limit: number = 20,
  ): MessageEnvelope[] {
    const rows = this.raw.prepare(`
      SELECT m.uid, m.subject, m.from_address, m.date, m.seen, m.has_attachments, m.preview
      FROM messages_fts fts
      JOIN messages m ON m.id = fts.rowid
      WHERE m.account_id = ? AND messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(accountId, query, limit) as any[];

    return rows.map((row: any) => ({
      uid: row.uid,
      seq: 0,
      subject: row.subject,
      from: row.from_address,
      date: row.date,
      seen: !!row.seen,
      hasAttachments: !!row.has_attachments,
      preview: row.preview ?? undefined,
      threadId: normalizeSubject(row.subject),
    }));
  }
}
