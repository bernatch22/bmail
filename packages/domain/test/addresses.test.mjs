/**
 * addresses.test.mjs — "Name <addr>" parsing, formatting and predicates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAddress,
  extractAddress,
  splitAddressList,
  parseAddressList,
  formatAddress,
  extractDomain,
  isSelfAddressed,
} from '../dist/addresses.js';

// ─── Parsing ───────────────────────────────────────────

test('parseAddress handles Name <addr>', () => {
  assert.deepEqual(parseAddress('Maria Macpherson <Maria@Example.com>'), {
    name: 'Maria Macpherson',
    address: 'maria@example.com',
  });
});

test('parseAddress handles quoted names and bare addresses', () => {
  assert.deepEqual(parseAddress('"Doe, Jane" <jane@x.com>'), {
    name: 'Doe, Jane',
    address: 'jane@x.com',
  });
  assert.deepEqual(parseAddress('  bob@x.com '), { name: '', address: 'bob@x.com' });
});

test('extractAddress matches the old inline addrOf helper', () => {
  assert.equal(extractAddress('Maria <MARIA@example.com>'), 'maria@example.com');
  assert.equal(extractAddress('maria@example.com'), 'maria@example.com');
});

// ─── Lists ─────────────────────────────────────────────

test('splitAddressList respects quoted commas', () => {
  const parts = splitAddressList('"Doe, Jane" <jane@x.com>, bob@x.com, ');
  assert.deepEqual(parts, ['"Doe, Jane" <jane@x.com>', 'bob@x.com']);
});

test('parseAddressList parses every entry', () => {
  const parsed = parseAddressList('A <a@x.com>, b@x.com');
  assert.deepEqual(parsed.map((p) => p.address), ['a@x.com', 'b@x.com']);
});

// ─── Formatting ────────────────────────────────────────

test('formatAddress round-trips, quoting names with commas', () => {
  assert.equal(formatAddress({ name: '', address: 'a@x.com' }), 'a@x.com');
  assert.equal(formatAddress({ name: 'Ann B', address: 'a@x.com' }), 'Ann B <a@x.com>');
  assert.equal(
    formatAddress({ name: 'Doe, Jane', address: 'j@x.com' }),
    '"Doe, Jane" <j@x.com>',
  );
});

// ─── Domain and self-detection ─────────────────────────

test('extractDomain works on full mailbox strings', () => {
  assert.equal(extractDomain('Maria <maria@example.com>'), 'example.com');
  assert.equal(extractDomain('no-at-sign'), '');
});

test('isSelfAddressed is true only when from and every to are me', () => {
  const me = 'me@bernardocastro.dev';
  assert.equal(isSelfAddressed(`Me <${me}>`, `Me <${me}>`, me), true);
  assert.equal(isSelfAddressed(`Me <${me}>`, `Me <${me}>, bob@x.com`, me), false);
  assert.equal(isSelfAddressed('bob@x.com', `Me <${me}>`, me), false);
  assert.equal(isSelfAddressed(`Me <${me}>`, `Me <${me}>`, ''), false);
});
