/**
 * sync-engine.ts — IMAP → SQLite sync engine.
 *
 * Responsibilities:
 *  1. Initial sync: pull folders + newest N envelopes per folder
 *  2. Incremental sync: fetch messages newer than the last synced UID
 *  3. Lazy body fetch: pull the full message on-demand when opened
 *  4. Periodic sync: backstop re-sync in the background
 *  5. Optional AI enrichment through an injected InsightProvider
 *
 * Migration notes: the bermail version imported the repository functions and
 * the AI service as module-level singletons. Here everything is injected via
 * the constructor — repository, account identity, and (optionally) the
 * insight provider — so two users on one server get two clean engines.
 */

import type { MailboxInfo, MessageEnvelope } from '@bmail/contract';
import type { MailRepository } from '@bmail/db/repository';

import type { ImapService, ImapMessageEnvelope } from './imap-service.js';
import type { InsightProvider } from './insight-provider.js';

// ─── Tuning constants ──────────────────────────────────

const INITIAL_SYNC_LIMIT = 200;

// Backstop poll — real-time push comes from the IMAP IDLE monitor; this is
// just a safety net, so it can be slow (was 1.5s once, which hammered the
// server).
const SYNC_INTERVAL_MS = 15_000;

// AI enrichment runs on its own, slower cadence.
const AI_INTERVAL_MS = 10_000;

// ─── Public shapes ─────────────────────────────────────

export interface SyncUpdate {
  mailboxes: MailboxInfo[];
  newMessages: { folder: string; messages: MessageEnvelope[] }[];
}

export type SyncChangeHandler = (update: SyncUpdate) => void;

export interface SyncEngineAccount {
  id: string;
  label: string;
  email: string;
}

// ─── Engine ────────────────────────────────────────────

export class SyncEngine {
  public readonly imap: ImapService;
  private readonly repository: MailRepository;
  private readonly accountId: string;
  private readonly accountLabel: string;
  private readonly accountEmail: string;
  private readonly insightProvider: InsightProvider | null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private aiTimer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;
  private changeHandlers: SyncChangeHandler[] = [];

  constructor(
    imap: ImapService,
    repository: MailRepository,
    account: SyncEngineAccount,
    insightProvider: InsightProvider | null = null,
  ) {
    this.imap = imap;
    this.repository = repository;
    this.accountId = account.id;
    this.accountLabel = account.label;
    this.accountEmail = account.email;
    this.insightProvider = insightProvider;
  }

  onChange(handler: SyncChangeHandler): void {
    this.changeHandlers.push(handler);
  }

  private notifyChange(update: SyncUpdate): void {
    for (const handler of this.changeHandlers) {
      handler(update);
    }
  }

  // ─── Initial sync ────────────────────────────────────

  async initialSync(): Promise<void> {
    console.log('  ⟳ Starting initial sync...');
    const start = Date.now();

    // Ensure the account row exists before anything references it.
    this.repository.upsertAccount(this.accountId, this.accountLabel, this.accountEmail);

    await this.syncFolders();

    // Sync envelopes for each folder.
    const allFolders = this.repository.getFolders(this.accountId);
    for (const folder of allFolders) {
      try {
        await this.syncEnvelopes(folder.path, INITIAL_SYNC_LIMIT);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`    ✗ Failed to sync ${folder.path}: ${message}`);
      }
    }

    // Eagerly fetch bodies for messages that don't have one yet.
    const foldersWithMessages = allFolders.filter((folder) => folder.messages > 0);
    for (const folder of foldersWithMessages) {
      const folderId = this.repository.getFolderId(this.accountId, folder.path);
      if (!folderId) {
        continue;
      }

      const { messages } = this.repository.getMessages(
        this.accountId,
        folder.path,
        INITIAL_SYNC_LIMIT,
        1,
      );

      let fetched = 0;
      for (const message of messages) {
        if (this.repository.hasMessageBody(folderId, message.uid)) {
          continue;
        }
        try {
          const full = await this.imap.getMessage(folder.path, message.uid);
          if (full) {
            this.repository.updateMessageBody(
              folderId,
              message.uid,
              full.textBody,
              full.htmlBody,
              full.to,
              full.cc,
            );
            fetched++;
          }
        } catch {
          // Skip individual message errors — one broken message must not
          // abort the whole folder.
        }
      }

      if (fetched > 0) {
        console.log(`    ✓ ${folder.path}: ${fetched} bodies fetched`);
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  ✓ Initial sync complete (${elapsed}s)`);
  }

  // ─── Folder sync ─────────────────────────────────────

  async syncFolders(silent = false): Promise<void> {
    const mailboxes = await this.imap.listMailboxes();

    for (const mailbox of mailboxes) {
      this.repository.upsertFolder(
        this.accountId,
        mailbox.path,
        mailbox.name,
        mailbox.messages,
        mailbox.unseen,
      );
    }

    if (!silent) {
      console.log(`    ✓ ${mailboxes.length} folders synced`);
    }
  }

  // ─── Envelope sync ───────────────────────────────────

  async syncEnvelopes(folderPath: string, limit: number = 50, silent = false): Promise<number> {
    const folderId = this.repository.getFolderId(this.accountId, folderPath);
    if (!folderId) {
      return 0;
    }

    const { messages: envelopes, total } = await this.imap.listMessages(folderPath, limit, 1);

    let count = 0;
    for (const envelope of envelopes) {
      this.upsertEnvelope(folderId, envelope);
      count++;
    }

    if (!silent && count > 0) {
      console.log(`    ✓ ${folderPath}: ${count}/${total} messages`);
    }

    return count;
  }

  /** Write one IMAP envelope into the local store (Date → ISO string here). */
  private upsertEnvelope(folderId: number, envelope: ImapMessageEnvelope): void {
    this.repository.upsertMessage(this.accountId, folderId, {
      uid: envelope.uid,
      messageId: envelope.messageId,
      inReplyTo: envelope.inReplyTo,
      subject: envelope.subject,
      from: envelope.from,
      to: envelope.to,
      cc: envelope.cc,
      date: envelope.date?.toISOString() ?? undefined,
      seen: envelope.seen,
      hasAttachments: envelope.hasAttachments,
      preview: '',
    });
  }

  // ─── Incremental sync ────────────────────────────────

  async incrementalSync(folderPath?: string): Promise<void> {
    if (this.syncing) {
      return;
    }
    this.syncing = true;

    try {
      const allFolders = folderPath
        ? [{ path: folderPath, messages: 1 }]
        : this.repository.getFolders(this.accountId);

      // Only sync folders that have messages (skip Calendar, Contacts, etc).
      const foldersToSync = allFolders.filter((folder) => folder.messages > 0);

      const newMessages: { folder: string; messages: MessageEnvelope[] }[] = [];

      for (const folder of foldersToSync) {
        const folderId = this.repository.getFolderId(this.accountId, folder.path);
        if (!folderId) {
          continue;
        }

        const highestUid = this.repository.getHighestUid(folderId);

        // Nothing synced yet — pull the newest page by envelope.
        if (highestUid === 0) {
          await this.syncEnvelopes(folder.path, INITIAL_SYNC_LIMIT, true);
          if (this.repository.getHighestUid(folderId) > 0) {
            const { messages } = this.repository.getMessages(this.accountId, folder.path, 50, 1);
            newMessages.push({ folder: folder.path, messages });
          }
          continue;
        }

        // Active server-side UID search for anything strictly newer than
        // what we already have. Avoids the stale cached `exists` count.
        let fresh: ImapMessageEnvelope[];
        try {
          fresh = await this.imap.fetchSince(folder.path, highestUid);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ fetchSince ${folder.path}: ${message}`);
          continue;
        }
        if (fresh.length === 0) {
          continue;
        }

        for (const envelope of fresh) {
          this.upsertEnvelope(folderId, envelope);
        }

        const { messages } = this.repository.getMessages(this.accountId, folder.path, 50, 1);
        newMessages.push({ folder: folder.path, messages });
      }

      await this.syncFolders(true);

      if (newMessages.length > 0) {
        // Fetch bodies for the new messages before notifying.
        for (const entry of newMessages) {
          const folderId = this.repository.getFolderId(this.accountId, entry.folder);
          if (!folderId) {
            continue;
          }
          for (const message of entry.messages) {
            if (this.repository.hasMessageBody(folderId, message.uid)) {
              continue;
            }
            try {
              const full = await this.imap.getMessage(entry.folder, message.uid);
              if (full) {
                this.repository.updateMessageBody(
                  folderId,
                  message.uid,
                  full.textBody,
                  full.htmlBody,
                  full.to,
                  full.cc,
                );
              }
            } catch {
              // Skip — the body can still be lazily fetched on open.
            }
          }
        }

        const mailboxes = this.repository.getFolders(this.accountId);
        console.log('  📬 New messages detected — pushing to UI');
        this.notifyChange({ mailboxes, newMessages });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Incremental sync failed: ${message}`);
    } finally {
      this.syncing = false;
    }
  }

  // ─── Lazy body fetch ─────────────────────────────────

  async fetchBody(
    folderPath: string,
    uid: number,
  ): Promise<{ textBody: string; htmlBody: string } | null> {
    const folderId = this.repository.getFolderId(this.accountId, folderPath);
    if (!folderId) {
      return null;
    }

    // Body already cached → caller should read it from the repository.
    if (this.repository.hasMessageBody(folderId, uid)) {
      return null;
    }

    const full = await this.imap.getMessage(folderPath, uid);
    if (!full) {
      return null;
    }

    this.repository.updateMessageBody(folderId, uid, full.textBody, full.htmlBody, full.to, full.cc);

    return { textBody: full.textBody, htmlBody: full.htmlBody };
  }

  // ─── Background sync ─────────────────────────────────

  startPeriodicSync(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`  ⟳ sync tick ${timestamp}`);
      this.incrementalSync().catch((err) => {
        console.error('  ✗ Periodic sync error:', err);
      });
    }, SYNC_INTERVAL_MS);
    console.log(`  ✓ Periodic sync: every ${SYNC_INTERVAL_MS / 1000}s`);

    // AI enrichment only runs when a provider was injected.
    if (this.insightProvider) {
      // Initial burst: process the backlog at startup.
      this.processAiInsights(50).catch((err) => {
        console.error('  ✗ Initial AI processing error:', err);
      });

      this.aiTimer = setInterval(() => {
        this.processAiInsights(20).catch((err) => {
          console.error('  ✗ AI processing error:', err);
        });
      }, AI_INTERVAL_MS);
      console.log(`  ✓ AI processing: every ${AI_INTERVAL_MS / 1000}s`);
    }
  }

  stopPeriodicSync(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.aiTimer) {
      clearInterval(this.aiTimer);
      this.aiTimer = null;
    }
  }

  // ─── Trigger sync for a specific folder (from IDLE) ──

  async onNewMail(folder: string): Promise<void> {
    await this.incrementalSync(folder);
  }

  // ─── AI processing ───────────────────────────────────

  async processAiInsights(batchSize: number = 20): Promise<void> {
    const provider = this.insightProvider;
    if (!provider) {
      return;
    }

    const unprocessed = this.repository.getUnprocessedMessages(this.accountId, batchSize);
    if (unprocessed.length === 0) {
      return;
    }

    console.log(`  🤖 Processing ${unprocessed.length} emails with AI...`);

    let processed = 0;
    const analyses = unprocessed.map(async (message) => {
      try {
        // Prefer plain text; fall back to a crudely-stripped HTML excerpt.
        const body =
          message.textBody ||
          message.htmlBody?.replace(/<[^>]+>/g, ' ').slice(0, 2000) ||
          '';

        const insight = await provider.analyzeEmail(message.subject, message.from, body);
        if (insight) {
          this.repository.updateAiInsight(message.folderId, message.uid, JSON.stringify(insight));
          processed++;
        }
      } catch (err) {
        console.error(
          `  ✗ AI failed for uid=${message.uid}:`,
          err instanceof Error ? err.message : err,
        );
      }
    });

    await Promise.all(analyses);

    // Single notification after the whole batch, so the UI refreshes once.
    if (processed > 0) {
      this.notifyChange({
        mailboxes: this.repository.getFolders(this.accountId),
        newMessages: [],
      });
    }
    console.log(`  ✓ AI processed ${processed}/${unprocessed.length} emails`);
  }
}
