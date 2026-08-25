/**
 * client.test.mjs — HTTP client tests against a stub fetch.
 *
 * No network: every test injects a fake fetch that records the calls it
 * receives and returns canned responses, then asserts on paths, methods,
 * headers per auth mode, 401 handling and attachment parsing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BmailClient, BmailApiError, parseAttachmentFilename } from '../dist/index.js';

// ─── Stub fetch helpers ────────────────────────────────

/** Build a Response-shaped object from a plain spec. */
function stubResponse({ status = 200, json = {}, headers = {}, buffer = null } = {}) {
  const normalizedHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value;
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status-${status}`,
    headers: { get: (name) => normalizedHeaders[name.toLowerCase()] ?? null },
    json: async () => json,
    arrayBuffer: async () => buffer ?? new ArrayBuffer(0),
  };
}

/** A fetch stub that records calls and replays canned responses in order. */
function stubFetch(...responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return responses.length > 1 ? responses.shift() : responses[0];
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function makeClient(fetchImpl, overrides = {}) {
  return new BmailClient({
    baseUrl: 'https://mail.test',
    fetch: fetchImpl,
    authMode: 'cookie',
    ...overrides,
  });
}

// ─── Paths and methods ─────────────────────────────────

test('listMessages hits the paginated messages route with encoding', async () => {
  const fetchImpl = stubFetch(stubResponse({ json: { data: [], total: 0, page: 2, pageSize: 10 } }));
  const client = makeClient(fetchImpl);

  const result = await client.listMessages('Sent Items', { page: 2, limit: 10 });

  assert.equal(
    fetchImpl.calls[0].url,
    'https://mail.test/api/mailboxes/Sent%20Items/messages?page=2&limit=10',
  );
  assert.equal(fetchImpl.calls[0].init.method, 'GET');
  assert.equal(result.page, 2);
});

test('getMessage unwraps the { data } envelope', async () => {
  const message = { uid: 7, subject: 'hi' };
  const fetchImpl = stubFetch(stubResponse({ json: { data: message } }));
  const client = makeClient(fetchImpl);

  const result = await client.getMessage('INBOX', 7);

  assert.equal(fetchImpl.calls[0].url, 'https://mail.test/api/mailboxes/INBOX/messages/7');
  assert.deepEqual(result, message);
});

test('message actions post to their sub-routes', async () => {
  const fetchImpl = stubFetch(stubResponse());
  const client = makeClient(fetchImpl);

  await client.markSeen('INBOX', 3);
  await client.markSeen('INBOX', 3, false);
  await client.flag('INBOX', 3);
  await client.flag('INBOX', 3, false);
  await client.trash('INBOX', 3);
  await client.archive('INBOX', 3);

  const suffixes = fetchImpl.calls.map((call) => call.url.split('/').pop());
  assert.deepEqual(suffixes, ['read', 'unread', 'flag', 'unflag', 'trash', 'archive']);
  for (const call of fetchImpl.calls) {
    assert.equal(call.init.method, 'POST');
  }
});

test('move posts the destination folder in the body', async () => {
  const fetchImpl = stubFetch(stubResponse());
  const client = makeClient(fetchImpl);

  await client.move('INBOX', 3, 'Archive');

  assert.equal(fetchImpl.calls[0].url, 'https://mail.test/api/mailboxes/INBOX/messages/3/move');
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { destination: 'Archive' });
});

test('delete uses the DELETE verb on the message resource', async () => {
  const fetchImpl = stubFetch(stubResponse());
  const client = makeClient(fetchImpl);

  await client.delete('Trash', 9);

  assert.equal(fetchImpl.calls[0].url, 'https://mail.test/api/mailboxes/Trash/messages/9');
  assert.equal(fetchImpl.calls[0].init.method, 'DELETE');
});

test('send posts attachments base64-encoded in the JSON body', async () => {
  const fetchImpl = stubFetch(stubResponse({ json: { message: { uid: 1 } } }));
  const client = makeClient(fetchImpl);

  await client.send({
    to: 'a@b.c',
    subject: 'doc',
    text: 'see attached',
    attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', contentBase64: 'QUJD' }],
  });

  assert.equal(fetchImpl.calls[0].url, 'https://mail.test/api/send');
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(body.attachments[0].contentBase64, 'QUJD');
  assert.equal(fetchImpl.calls[0].init.headers['Content-Type'], 'application/json');
});

// ─── Auth modes ────────────────────────────────────────

test('cookie mode sends credentials:include and no Authorization header', async () => {
  const fetchImpl = stubFetch(stubResponse({ json: { data: [] } }));
  const client = makeClient(fetchImpl, { authMode: 'cookie' });

  await client.listMailboxes();

  assert.equal(fetchImpl.calls[0].init.credentials, 'include');
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, undefined);
});

test('bearer mode sends the Authorization header and omits credentials', async () => {
  const fetchImpl = stubFetch(stubResponse({ json: { data: [] } }));
  const client = makeClient(fetchImpl, { authMode: 'bearer', token: 'tok123' });

  await client.listMailboxes();

  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer tok123');
  assert.equal(fetchImpl.calls[0].init.credentials, 'omit');
});

test('bearer login captures the token returned by the server', async () => {
  const fetchImpl = stubFetch(
    stubResponse({ json: { user: { email: 'a@b.c', org: 'B' }, token: 'fresh' } }),
    stubResponse({ json: { data: [] } }),
  );
  const client = makeClient(fetchImpl, { authMode: 'bearer' });

  await client.login('a@b.c', 'pw');
  await client.listMailboxes();

  assert.equal(client.token, 'fresh');
  assert.equal(fetchImpl.calls[1].init.headers.Authorization, 'Bearer fresh');
});

// ─── 401 handling ──────────────────────────────────────

test('a 401 fires onUnauthorized and throws BmailApiError', async () => {
  let fired = 0;
  const fetchImpl = stubFetch(stubResponse({ status: 401, json: { error: 'expired' } }));
  const client = makeClient(fetchImpl, { onUnauthorized: () => { fired += 1; } });

  await assert.rejects(
    () => client.listMailboxes(),
    (error) => error instanceof BmailApiError && error.status === 401 && error.message === 'expired',
  );
  assert.equal(fired, 1);
});

test('a 401 on login does NOT fire onUnauthorized (wrong password, not expiry)', async () => {
  let fired = 0;
  const fetchImpl = stubFetch(stubResponse({ status: 401, json: { error: 'bad credentials' } }));
  const client = makeClient(fetchImpl, { onUnauthorized: () => { fired += 1; } });

  await assert.rejects(() => client.login('a@b.c', 'nope'), /bad credentials/);
  assert.equal(fired, 0);
});

test('me() returns null on any failure instead of throwing', async () => {
  const fetchImpl = stubFetch(stubResponse({ status: 401, json: { error: 'no session' } }));
  const client = makeClient(fetchImpl);

  assert.equal(await client.me(), null);
});

// ─── Attachments ───────────────────────────────────────

test('getAttachmentUrl builds the absolute attachment route', () => {
  const client = makeClient(stubFetch(stubResponse()));

  assert.equal(
    client.getAttachmentUrl('Sent Items', 5, '1.2'),
    'https://mail.test/api/mailboxes/Sent%20Items/messages/5/attachments/1.2',
  );
});

test('downloadAttachment parses filename, contentType and bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const fetchImpl = stubFetch(stubResponse({
    buffer: bytes,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="invoice.pdf"',
    },
  }));
  const client = makeClient(fetchImpl);

  const result = await client.downloadAttachment('INBOX', 4, '2');

  assert.equal(fetchImpl.calls[0].url, 'https://mail.test/api/mailboxes/INBOX/messages/4/attachments/2');
  assert.equal(result.filename, 'invoice.pdf');
  assert.equal(result.contentType, 'application/pdf');
  assert.deepEqual(Array.from(result.bytes), [1, 2, 3]);
});

test('parseAttachmentFilename handles RFC 5987, quoted and missing headers', () => {
  assert.equal(
    parseAttachmentFilename("attachment; filename*=UTF-8''se%C3%B1al.pdf"),
    'señal.pdf',
  );
  assert.equal(parseAttachmentFilename('attachment; filename="a b.txt"'), 'a b.txt');
  assert.equal(parseAttachmentFilename('attachment; filename=plain.txt'), 'plain.txt');
  assert.equal(parseAttachmentFilename(null), 'attachment');
});
