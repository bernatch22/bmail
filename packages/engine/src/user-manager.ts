/**
 * user-manager.ts — One IMAP/monitor/sync trio per logged-in user.
 *
 * Created on login, reaped on idle. Injected dependencies replace bermail's
 * module singletons: the repository, the org registry, an optional
 * InsightProvider, and a ChangeNotifier (implemented by the server's WS hub)
 * instead of a hard WsHub reference.
 */

import type { MailRepository } from '@bmail/db/repository';

import { ImapService } from './imap-service.js';
import { ImapMonitor } from './imap-monitor.js';
import { SyncEngine } from './sync-engine.js';
import { MailService } from './mail-service.js';
import { buildAccountConfig, type OrgRegistry } from './org-registry.js';
import type { ChangeNotifier } from './change-notifier.js';
import type { InsightProvider } from './insight-provider.js';

// ─── Shapes ────────────────────────────────────────────

export interface UserTrio {
  imap: ImapService;
  monitor: ImapMonitor;
  sync: SyncEngine;
  /** Route-level operations bundled per user (list, get, trash, ...). */
  mail: MailService;
  email: string;
  lastActive: number;
}

export interface UserManagerDeps {
  repository: MailRepository;
  orgRegistry: OrgRegistry;
  notifier: ChangeNotifier;
  /** Optional AI plugin; omit it and no AI work happens. */
  insightProvider?: InsightProvider;
}

// ─── Manager ───────────────────────────────────────────

export class UserManager {
  private readonly deps: UserManagerDeps;
  private readonly byUser = new Map<string, UserTrio>();
  private readonly pending = new Map<string, Promise<UserTrio>>();

  constructor(deps: UserManagerDeps) {
    this.deps = deps;
  }

  async getOrCreate(userId: string, email: string, pass: string): Promise<UserTrio> {
    const existing = this.byUser.get(userId);
    if (existing) {
      existing.lastActive = Date.now();
      return existing;
    }

    // Deduplicate concurrent logins for the same user: the second caller
    // awaits the first one's in-flight creation instead of racing it.
    const inflight = this.pending.get(userId);
    if (inflight) {
      return inflight;
    }

    const creation = this.create(userId, email, pass);
    this.pending.set(userId, creation);
    try {
      return await creation;
    } finally {
      this.pending.delete(userId);
    }
  }

  private async create(userId: string, email: string, pass: string): Promise<UserTrio> {
    const { repository, orgRegistry, notifier, insightProvider } = this.deps;

    const accountConfig = buildAccountConfig(orgRegistry, email, pass);

    const imap = new ImapService(accountConfig);
    await imap.connect();

    const sync = new SyncEngine(
      imap,
      repository,
      { id: userId, label: accountConfig.label, email },
      insightProvider ?? null,
    );
    const monitor = new ImapMonitor(accountConfig);
    const mail = new MailService(repository, sync, userId);

    // Per-user push: sync data updates and IDLE new-mail notifications.
    sync.onChange((update) => {
      notifier.sendToUser(userId, {
        type: 'sync_update',
        payload: { mailboxes: update.mailboxes, newMessages: update.newMessages },
      });
    });

    monitor.onEvent((event) => {
      // IDLE detected new mail → pull it, then notify.
      sync.onNewMail(event.folder).catch(() => {});
      notifier.sendToUser(userId, {
        type: event.type,
        payload: {
          folder: event.folder,
          count: event.count,
          previousCount: event.previousCount,
        },
      });
    });

    await sync.initialSync();
    await monitor.start('INBOX').catch(() => {});
    sync.startPeriodicSync();

    const trio: UserTrio = { imap, monitor, sync, mail, email, lastActive: Date.now() };
    this.byUser.set(userId, trio);
    return trio;
  }

  get(userId: string): UserTrio | undefined {
    const trio = this.byUser.get(userId);
    if (trio) {
      trio.lastActive = Date.now();
    }
    return trio;
  }

  async teardown(userId: string): Promise<void> {
    const trio = this.byUser.get(userId);
    if (!trio) {
      return;
    }
    this.byUser.delete(userId);
    trio.sync.stopPeriodicSync();
    await trio.monitor.stop().catch(() => {});
    await trio.imap.disconnect().catch(() => {});
  }

  /** Reap idle trios (free IMAP connections; synced mail stays in SQLite). */
  startReaper(idleMs = 30 * 60 * 1000): void {
    setInterval(() => {
      const now = Date.now();
      for (const [userId, trio] of this.byUser) {
        if (now - trio.lastActive > idleMs) {
          this.teardown(userId).catch(() => {});
        }
      }
    }, 60 * 1000);
  }
}
