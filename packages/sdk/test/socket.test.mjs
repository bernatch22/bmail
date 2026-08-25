/**
 * socket.test.mjs — WebSocket client tests against a stub WebSocket.
 *
 * The stub records constructed URLs and lets tests drive onmessage/onclose
 * by hand, so we can assert dispatching, validation, token query params and
 * the user-close vs server-close reconnect distinction without a server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BmailSocket, BmailClient } from '../dist/index.js';

// ─── Stub WebSocket ────────────────────────────────────

function makeStubWebSocketImpl() {
  const instances = [];

  class StubWebSocket {
    constructor(url) {
      this.url = url;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.closed = false;
      instances.push(this);
    }

    close() {
      this.closed = true;
    }
  }

  StubWebSocket.instances = instances;
  return StubWebSocket;
}

// ─── Tests ─────────────────────────────────────────────

test('valid events are dispatched to subscribers; junk is dropped', () => {
  const Impl = makeStubWebSocketImpl();
  const socket = new BmailSocket({ url: 'wss://mail.test/ws', WebSocketImpl: Impl });
  socket.connect();

  const received = [];
  socket.subscribe((event) => received.push(event));

  const ws = Impl.instances[0];
  ws.onmessage({ data: JSON.stringify({ type: 'new_message', payload: { folder: 'INBOX' } }) });
  ws.onmessage({ data: 'not json at all' });
  ws.onmessage({ data: JSON.stringify({ type: 'bogus_type', payload: {} }) });

  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'new_message');
  socket.disconnect();
});

test('subscribe returns an unsubscribe function', () => {
  const Impl = makeStubWebSocketImpl();
  const socket = new BmailSocket({ url: 'wss://mail.test/ws', WebSocketImpl: Impl });
  socket.connect();

  const received = [];
  const unsubscribe = socket.subscribe((event) => received.push(event));
  unsubscribe();

  Impl.instances[0].onmessage({ data: JSON.stringify({ type: 'sync_update', payload: {} }) });

  assert.equal(received.length, 0);
  socket.disconnect();
});

test('bearer tokens ride the URL as a query parameter', () => {
  const Impl = makeStubWebSocketImpl();
  const socket = new BmailSocket({
    url: 'wss://mail.test/ws',
    WebSocketImpl: Impl,
    token: () => 'tok/123',
  });
  socket.connect();

  assert.equal(Impl.instances[0].url, 'wss://mail.test/ws?token=tok%2F123');
  socket.disconnect();
});

test('disconnect closes without scheduling a reconnect', () => {
  const Impl = makeStubWebSocketImpl();
  const socket = new BmailSocket({ url: 'wss://mail.test/ws', WebSocketImpl: Impl });
  socket.connect();

  socket.disconnect();
  // A close after a user disconnect must NOT create a new socket.
  Impl.instances[0].onclose?.({});

  assert.equal(Impl.instances.length, 1);
  assert.equal(Impl.instances[0].closed, true);
});

test('BmailClient.connect derives ws URL from the https baseUrl', () => {
  const Impl = makeStubWebSocketImpl();
  const client = new BmailClient({
    baseUrl: 'https://mail.test',
    authMode: 'cookie',
    fetch: async () => { throw new Error('unused'); },
    WebSocketImpl: Impl,
  });

  const socket = client.connect();

  assert.equal(Impl.instances[0].url, 'wss://mail.test/ws');
  socket.disconnect();
});

// ─── Connection status ─────────────────────────────────

test('onStatus reports open and close, and only on a real change', () => {
  const sockets = [];

  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      sockets.push(this);
    }
    close() {
      this.onclose?.({});
    }
  }

  const socket = new BmailSocket({ url: 'wss://example.test/ws', WebSocketImpl: FakeSocket });
  const seen = [];
  socket.onStatus((connected) => seen.push(connected));

  socket.connect();
  assert.equal(socket.connected, false, 'not connected until the socket opens');

  sockets[0].onopen({});
  assert.equal(socket.connected, true);

  // A second open without an intervening close must not repeat the event.
  sockets[0].onopen({});

  socket.disconnect();

  assert.deepEqual(seen, [true, false]);
  assert.equal(socket.connected, false);
});
