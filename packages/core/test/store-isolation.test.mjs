/**
 * store-isolation.test.mjs — Two accounts in ONE database must never see
 * each other's mail.
 *
 * This is the multi-account case a desktop client lives in: one local cache,
 * several mailboxes. The regression it guards is real — the query that pulls
 * a thread's sent copies into a folder listing filtered by thread id and by
 * "some other folder", but not by account, so account A's list grew rows
 * belonging to account B as soon as the two shared a thread id (which is
 * what happens the moment one of them mails the other).
 *
 * Runs against the compiled output (dist/), like the other suites.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase, MailRepository } from '../dist/store/index.js';

// ─── Fixture ───────────────────────────────────────────

// One Message-Id shared by both accounts: A sent it, B received it.
const SHARED_THREAD = '<shared-thread@example.com>';

function openTemporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-store-test-'));
  const database = createDatabase(path.join(directory, 'test.db'));
  const repository = new MailRepository(database);

  return {
    repository,
    close() {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Give `accountId` an INBOX and a Sent folder with one message each. */
function seedAccount(repository, accountId, email, inboxSubject, sentSubject) {
  repository.upsertAccount(accountId, email, email);
  repository.upsertFolder(accountId, 'INBOX', 'INBOX', 1, 0);
  repository.upsertFolder(accountId, 'Sent', 'Sent', 1, 0);

  const inboxId = repository.getFolderId(accountId, 'INBOX');
  const sentId = repository.getFolderId(accountId, 'Sent');

  repository.upsertMessage(accountId, inboxId, {
    uid: 1,
    subject: inboxSubject,
    from: `someone@example.com`,
    date: '2026-08-25T10:00:00.000Z',
    seen: false,
    hasAttachments: false,
    messageId: SHARED_THREAD,
  });

  repository.upsertMessage(accountId, sentId, {
    uid: 1,
    subject: sentSubject,
    from: email,
    date: '2026-08-25T10:05:00.000Z',
    seen: true,
    hasAttachments: false,
    messageId: `<sent-${accountId}@example.com>`,
    inReplyTo: SHARED_THREAD,
  });

  return { inboxId, sentId };
}

// ─── Tests ─────────────────────────────────────────────

test('a folder listing never returns another account rows', () => {
  const store = openTemporaryStore();

  try {
    seedAccount(store.repository, 'account_a', 'a@example.com', 'shared subject', 'A replies');
    seedAccount(store.repository, 'account_b', 'b@example.com', 'shared subject', 'B replies');

    const listing = store.repository.getMessages('account_a', 'INBOX', 50, 1);
    const subjects = listing.messages.map((message) => message.subject);

    assert.ok(subjects.includes('A replies'), 'own sent copy must still be pulled into the thread');
    assert.ok(!subjects.includes('B replies'), "another account's sent copy must never appear");
  } finally {
    store.close();
  }
});

test('the thread view is scoped to the account too', () => {
  const store = openTemporaryStore();

  try {
    seedAccount(store.repository, 'account_a', 'a@example.com', 'shared subject', 'A replies');
    seedAccount(store.repository, 'account_b', 'b@example.com', 'shared subject', 'B replies');

    const inboxId = store.repository.getFolderId('account_a', 'INBOX');
    const threadId = store.repository.getMessages('account_a', 'INBOX', 50, 1).messages[0].threadId;

    const thread = store.repository.getThreadMessages('account_a', threadId);
    const froms = thread.map((message) => message.from);

    assert.ok(!froms.includes('b@example.com'), "another account's message must never join the thread");
    assert.ok(inboxId > 0);
  } finally {
    store.close();
  }
});

test('search only ever matches the account own mail', () => {
  const store = openTemporaryStore();

  try {
    seedAccount(store.repository, 'account_a', 'a@example.com', 'quarterly report', 'A replies');
    seedAccount(store.repository, 'account_b', 'b@example.com', 'quarterly report', 'B replies');

    const hits = store.repository.searchMessages('account_a', 'quarterly', 20);
    assert.equal(hits.length, 1, 'the identical subject in account B must not be a hit');
  } finally {
    store.close();
  }
});
