/**
 * reply.test.mjs — Reply recipient resolution, including the self-addressed
 * case that motivated bermail commit 7ebf723, plus quoted-body shapes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveReplyRecipients,
  buildReplySubject,
  buildForwardSubject,
  buildQuotedBody,
  buildForwardBody,
} from '../dist/logic/reply.js';

const ME = 'me@bernardocastro.dev';

// Small factory to keep the fixtures readable.
function msg(from, to, messageId) {
  return { from, to, subject: 'Hello', messageId, date: null };
}

// ─── resolveReplyRecipients ────────────────────────────

test('replying to someone else goes to their from', () => {
  const other = msg('Maria <maria@example.com>', `Me <${ME}>`, '<m1@x>');
  const result = resolveReplyRecipients(other, [other], ME);

  assert.equal(result.to, 'Maria <maria@example.com>');
  assert.equal(result.inReplyTo, '<m1@x>');
});

test('replying to my own message targets the thread counterparty', () => {
  const theirs = msg('Maria <maria@example.com>', `Me <${ME}>`, '<m1@x>');
  const mine = msg(`Me <${ME}>`, 'Maria <maria@example.com>', '<m2@x>');
  const result = resolveReplyRecipients(mine, [theirs, mine], ME);

  // Must go back to Maria, threaded under HER message.
  assert.equal(result.to, 'Maria <maria@example.com>');
  assert.equal(result.inReplyTo, '<m1@x>');
});

test('self-addressed message (from AND to are me) still finds the counterparty', () => {
  const theirs = msg('Maria <maria@example.com>', `Me <${ME}>`, '<m1@x>');
  const selfNote = msg(`Me <${ME}>`, `Me <${ME}>`, '<m3@x>');
  const result = resolveReplyRecipients(selfNote, [theirs, selfNote], ME);

  assert.equal(result.to, 'Maria <maria@example.com>');
});

test('all-mine thread replies to the non-self recipients of my message', () => {
  const mine = msg(`Me <${ME}>`, `Me <${ME}>, Bob <bob@example.com>`, '<m4@x>');
  const result = resolveReplyRecipients(mine, [mine], ME);

  assert.equal(result.to, 'Bob <bob@example.com>');
});

test('pure self-mail thread falls back to the original to line', () => {
  const mine = msg(`Me <${ME}>`, `Me <${ME}>`, '<m5@x>');
  const result = resolveReplyRecipients(mine, [mine], ME);

  assert.equal(result.to, `Me <${ME}>`);
});

test('without a known myEmail, reply simply targets from', () => {
  const mine = msg(`Me <${ME}>`, 'Maria <maria@example.com>', '<m6@x>');
  const result = resolveReplyRecipients(mine, [mine], undefined);

  assert.equal(result.to, `Me <${ME}>`);
});

// ─── Subjects ──────────────────────────────────────────

test('reply/forward subjects prefix once, never twice', () => {
  assert.equal(buildReplySubject('Hello'), 'Re: Hello');
  assert.equal(buildReplySubject('Re: Hello'), 'Re: Hello');
  assert.equal(buildForwardSubject('Hello'), 'Fwd: Hello');
  assert.equal(buildForwardSubject('Fwd: Hello'), 'Fwd: Hello');
});

// ─── Quoted bodies ─────────────────────────────────────

const source = {
  from: 'Maria <maria@example.com>',
  date: '2026-08-25T10:30:00.000Z',
  subject: 'Hello',
  html: '<p>original</p>',
};

test('buildQuotedBody wraps the original in a gmail_quote with attribution', () => {
  const html = buildQuotedBody('<div>my reply</div>', source);

  assert.match(html, /class="gmail_quote"/);
  assert.match(html, /wrote:/);
  assert.match(html, /maria@example\.com/);
  assert.match(html, /<p>original<\/p>/);
  assert.ok(html.startsWith('<div>my reply</div>'));
});

test('buildForwardBody carries the dashed forwarded-message header', () => {
  const html = buildForwardBody('', source, 'bob@example.com');

  assert.match(html, /Forwarded message/);
  assert.match(html, /Subject: Hello/);
  assert.match(html, /To: bob@example\.com/);
});
