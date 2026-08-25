/**
 * threading.test.mjs — Subject normalization and thread id computation.
 *
 * Runs against the compiled output (dist/), which is what consumers import.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSubject,
  isReplySubject,
  computeThreadId,
} from '../dist/logic/threading.js';

// ─── normalizeSubject ──────────────────────────────────

test('normalizeSubject strips stacked Re:/Fwd:/FW: prefixes', () => {
  assert.equal(normalizeSubject('Re: Re: Fwd: Hello'), 'hello');
  assert.equal(normalizeSubject('FW: RE: Status update'), 'status update');
});

test('normalizeSubject trims and lowercases plain subjects', () => {
  assert.equal(normalizeSubject('  Hello World  '), 'hello world');
});

test('normalizeSubject does not eat "re" inside a word', () => {
  assert.equal(normalizeSubject('Retreat plans'), 'retreat plans');
});

// ─── isReplySubject ────────────────────────────────────

test('isReplySubject detects reply/forward prefixes only', () => {
  assert.equal(isReplySubject('Re: Hello'), true);
  assert.equal(isReplySubject('fwd: Hello'), true);
  assert.equal(isReplySubject('Hello'), false);
  assert.equal(isReplySubject('Retreat'), false);
});

// ─── computeThreadId ───────────────────────────────────

// A lookup stub over a tiny in-memory "store".
function lookupOver(rows) {
  return {
    findThreadIdByMessageId(messageId) {
      const row = rows.find((r) => r.messageId === messageId);
      return row ? row.threadId : null;
    },
    findThreadIdByNormalizedSubject(normalized, excludingMessageId) {
      const row = rows.find(
        (r) =>
          r.messageId !== excludingMessageId &&
          normalizeSubject(r.subject) === normalized,
      );
      return row ? row.threadId : null;
    },
  };
}

const store = [
  { messageId: '<a@x>', subject: 'Hello', threadId: '<a@x>' },
  { messageId: '<b@y>', subject: 'Other topic', threadId: '<b@y>' },
];

test('phase 1: In-Reply-To joins the parent thread', () => {
  const threadId = computeThreadId(
    { messageId: '<c@z>', inReplyTo: '<a@x>', subject: 'Re: Hello' },
    lookupOver(store),
  );
  assert.equal(threadId, '<a@x>');
});

test('phase 2: Re: subject without In-Reply-To joins by normalized subject', () => {
  const threadId = computeThreadId(
    { messageId: '<c@z>', subject: 'Re: hello' },
    lookupOver(store),
  );
  assert.equal(threadId, '<a@x>');
});

test('phase 2 guard: a NEW message never joins by subject alone', () => {
  const threadId = computeThreadId(
    { messageId: '<c@z>', subject: 'Hello' },
    lookupOver(store),
  );
  // Same words, no Re: prefix → its own thread.
  assert.equal(threadId, '<c@z>');
});

test('phase 3: unmatched message starts a thread with its own Message-ID', () => {
  const threadId = computeThreadId(
    { messageId: '<new@z>', subject: 'Brand new' },
    lookupOver(store),
  );
  assert.equal(threadId, '<new@z>');
});

test('fallback: no headers at all → normalized subject', () => {
  const threadId = computeThreadId(
    { subject: 'Re: Orphan' },
    lookupOver([]),
  );
  assert.equal(threadId, 'orphan');
});
