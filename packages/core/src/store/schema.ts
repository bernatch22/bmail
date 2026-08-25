/**
 * schema.ts — Drizzle ORM schema for the BMail local mail store.
 *
 * Three tables: accounts, folders, messages. Migrated verbatim from
 * @shmail/db (bermail) — column names and defaults are unchanged so the
 * existing production database opens as-is.
 *
 * NOTE on duplication: the authoritative DDL is the hand-written SQL in
 * index.ts (it also creates the FTS5 virtual table and its triggers, which
 * Drizzle cannot express). This Drizzle schema exists ONLY to give queries
 * static types; drizzle-kit generate/push is NOT part of the workflow.
 * If you change a table, change BOTH this file and CREATE_TABLES_SQL.
 */

import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// ─── Accounts ──────────────────────────────────────────

export const accounts = sqliteTable('accounts', {
  id:    text('id').primaryKey(),
  label: text('label').notNull(),
  email: text('email').notNull(),

  // Legacy column from the Outlook era. Every self-hosted account today is
  // Maddy/IMAP, but existing rows carry 'outlook' and dropping a column in
  // SQLite means rebuilding the table — deliberately kept. Do NOT drop it.
  provider: text('provider').notNull().default('outlook'),
});

// ─── Folders ───────────────────────────────────────────

export const folders = sqliteTable('folders', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  accountId:     text('account_id').notNull().references(() => accounts.id),
  path:          text('path').notNull(),
  name:          text('name').notNull(),
  totalMessages: integer('total_messages').default(0),
  unseenCount:   integer('unseen_count').default(0),
  lastSyncedAt:  text('last_synced_at'),
}, (t) => ({
  uniqPath: uniqueIndex('folders_account_path').on(t.accountId, t.path),
}));

// ─── Messages ──────────────────────────────────────────

export const messages = sqliteTable('messages', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  accountId:      text('account_id').notNull().references(() => accounts.id),
  folderId:       integer('folder_id').notNull().references(() => folders.id),
  uid:            integer('uid').notNull(),
  messageId:      text('message_id'),
  inReplyTo:      text('in_reply_to'),
  threadId:       text('thread_id').notNull().default(''),
  subject:        text('subject').notNull().default(''),
  fromAddress:    text('from_address').notNull().default(''),
  toAddresses:    text('to_addresses').default(''),
  ccAddresses:    text('cc_addresses').default(''),
  date:           text('date'),
  seen:           integer('seen', { mode: 'boolean' }).default(false),
  flagged:        integer('flagged', { mode: 'boolean' }).default(false),
  hasAttachments: integer('has_attachments', { mode: 'boolean' }).default(false),
  preview:        text('preview').default(''),
  textBody:       text('text_body').default(''),
  htmlBody:       text('html_body').default(''),
  aiInsight:      text('ai_insight'),
  aiProcessed:    integer('ai_processed', { mode: 'boolean' }).default(false),
  syncedAt:       text('synced_at').notNull(),
}, (t) => ({
  uniqUid:   uniqueIndex('messages_folder_uid').on(t.folderId, t.uid),
  threadIdx: index('messages_thread_id').on(t.folderId, t.threadId),
  msgIdIdx:  index('messages_message_id').on(t.accountId, t.messageId),
}));

// ─── Row type exports ──────────────────────────────────

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
