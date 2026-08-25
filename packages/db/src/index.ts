/**
 * index.ts — Database connection for @bmail/db.
 *
 * The old @shmail/db exposed a mandatory module-level singleton (getDb()).
 * Here the connection is INJECTABLE: createDatabase(path) returns a handle
 * that you pass to MailRepository. A convenience openDefaultDatabase() keeps
 * the old "just works" behavior for the server, but nothing forces it.
 *
 * The hand-written CREATE_TABLES_SQL below is the SINGLE SOURCE OF TRUTH for
 * the on-disk schema: it also creates the FTS5 virtual table and its sync
 * triggers, which the Drizzle schema in schema.ts cannot express. schema.ts
 * duplicates the three tables purely for query typing — keep them in sync.
 */

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

// ─── Handle type ───────────────────────────────────────

/**
 * Everything a consumer needs from one open database: the typed Drizzle
 * facade for normal queries, the raw better-sqlite3 connection for FTS5 and
 * dynamic-placeholder queries, and a close() that owns both.
 */
export interface BmailDatabase {
  drizzle: ReturnType<typeof createDrizzleHandle>;
  sqlite: InstanceType<typeof Database>;
  close(): void;
}

// Small named helper so BmailDatabase.drizzle gets a precise type without
// repeating the generics dance inline.
function createDrizzleHandle(sqlite: InstanceType<typeof Database>) {
  return drizzle(sqlite, { schema });
}

// ─── Opening a database ────────────────────────────────

/**
 * Open (or create) the mail store at `databasePath`, apply pragmas and run
 * the idempotent auto-migration DDL. Pure function of its argument: call it
 * twice with two paths and you get two independent databases.
 */
export function createDatabase(databasePath: string): BmailDatabase {
  const parentDirectory = path.dirname(databasePath);
  if (!fs.existsSync(parentDirectory)) {
    fs.mkdirSync(parentDirectory, { recursive: true });
  }

  const sqlite = new Database(databasePath);

  // WAL allows concurrent readers while the sync engine writes.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  // Idempotent: every statement is CREATE ... IF NOT EXISTS.
  sqlite.exec(CREATE_TABLES_SQL);

  const drizzleHandle = createDrizzleHandle(sqlite);

  return {
    drizzle: drizzleHandle,
    sqlite,
    close() {
      sqlite.close();
    },
  };
}

// ─── Convenience default ───────────────────────────────

/**
 * Where the default database lives when no explicit path is given.
 * Order matters: BMAIL_DB (new) → SHMAIL_DB (legacy env, still set in the
 * bermail deployment) → the legacy on-disk location, so the migrated server
 * keeps reading the production data without any env change.
 */
export function resolveDefaultDatabasePath(): string {
  const homeDirectory = process.env.HOME ?? process.env.USERPROFILE ?? '.';

  if (process.env.BMAIL_DB) {
    return process.env.BMAIL_DB;
  }

  if (process.env.SHMAIL_DB) {
    return process.env.SHMAIL_DB;
  }

  return path.join(homeDirectory, '.bermail', 'shmail.db');
}

/** Open the default database (see resolveDefaultDatabasePath). */
export function openDefaultDatabase(): BmailDatabase {
  return createDatabase(resolveDefaultDatabasePath());
}

// ─── Re-exports ────────────────────────────────────────

export { schema };
export { MailRepository, normalizeSubject } from './repository.js';

// ─── Auto-migration DDL (single source of truth) ───────

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  email TEXT NOT NULL,
  -- Legacy Outlook-era column; kept on purpose (see schema.ts).
  provider TEXT NOT NULL DEFAULT 'outlook'
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  total_messages INTEGER DEFAULT 0,
  unseen_count INTEGER DEFAULT 0,
  last_synced_at TEXT,
  UNIQUE(account_id, path)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  folder_id INTEGER NOT NULL REFERENCES folders(id),
  uid INTEGER NOT NULL,
  message_id TEXT,
  in_reply_to TEXT,
  thread_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  from_address TEXT NOT NULL DEFAULT '',
  to_addresses TEXT DEFAULT '',
  cc_addresses TEXT DEFAULT '',
  date TEXT,
  seen INTEGER DEFAULT 0,
  flagged INTEGER DEFAULT 0,
  has_attachments INTEGER DEFAULT 0,
  preview TEXT DEFAULT '',
  text_body TEXT DEFAULT '',
  html_body TEXT DEFAULT '',
  ai_insight TEXT,
  ai_processed INTEGER DEFAULT 0,
  synced_at TEXT NOT NULL,
  UNIQUE(folder_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_messages_folder ON messages(folder_id, uid DESC);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(folder_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(folder_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_msgid ON messages(account_id, message_id);

-- Full-text search over the fields people actually search.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  subject, from_address, to_addresses, text_body,
  content=messages, content_rowid=id
);

-- Triggers keep the FTS index in lockstep with the messages table.
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, from_address, to_addresses, text_body)
  VALUES (new.id, new.subject, new.from_address, new.to_addresses, new.text_body);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, to_addresses, text_body)
  VALUES ('delete', old.id, old.subject, old.from_address, old.to_addresses, old.text_body);
  INSERT INTO messages_fts(rowid, subject, from_address, to_addresses, text_body)
  VALUES (new.id, new.subject, new.from_address, new.to_addresses, new.text_body);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, to_addresses, text_body)
  VALUES ('delete', old.id, old.subject, old.from_address, old.to_addresses, old.text_body);
END;
`;
