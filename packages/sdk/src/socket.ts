/**
 * socket.ts — BmailSocket, the WebSocket half of the SDK.
 *
 * Migrated from bermail/packages/web/src/ws.ts. Changes from the original:
 *   - The WebSocket constructor is injectable (React Native, Node's `ws`).
 *   - Reconnection uses exponential backoff instead of a flat 3s, so a dead
 *     server is not hammered forever at full rate.
 *   - Incoming frames are validated with the contract's isWsEvent guard
 *     before listeners see them, instead of a blind JSON.parse-and-cast.
 *   - Bearer tokens are appended as a ?token= query parameter (a WebSocket
 *     handshake cannot carry an Authorization header on every platform).
 */

import { isWsEvent, type WsEvent } from '@bmail/core/types';

import type { WebSocketConstructorLike, WebSocketLike } from './types.js';

// ─── Types ─────────────────────────────────────────────

export type WsListener = (event: WsEvent) => void;

/** Notified when the connection opens (`true`) or drops (`false`). */
export type WsStatusListener = (connected: boolean) => void;

export interface BmailSocketOptions {
  /** Full ws:// or wss:// URL of the server's realtime endpoint. */
  url: string;

  /** WebSocket constructor; defaults to globalThis.WebSocket. */
  WebSocketImpl?: WebSocketConstructorLike;

  /**
   * Bearer-mode token supplier. Read on EVERY (re)connect so a refreshed
   * token is picked up without recreating the socket. Undefined in cookie
   * mode: the handshake rides on the browser cookie jar instead.
   */
  token?: () => string | null;
}

// ─── Backoff schedule ──────────────────────────────────

// First retry is quick (transient blips), then we back off up to 30s.
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

// ─── Socket ────────────────────────────────────────────

export class BmailSocket {
  private readonly _options: BmailSocketOptions;
  private readonly _listeners: Set<WsListener> = new Set();
  private readonly _statusListeners: Set<WsStatusListener> = new Set();
  private _connected = false;

  private _ws: WebSocketLike | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts = 0;
  private _closedByUser = false;

  constructor(options: BmailSocketOptions) {
    this._options = options;
  }

  // ─── Lifecycle ───────────────────────────────────────

  connect(): void {
    this._closedByUser = false;

    const WebSocketImpl =
      this._options.WebSocketImpl ??
      ((globalThis as { WebSocket?: WebSocketConstructorLike }).WebSocket);

    if (!WebSocketImpl) {
      throw new Error(
        'No WebSocket implementation available; pass WebSocketImpl (e.g. the `ws` package in Node)',
      );
    }

    this._ws = new WebSocketImpl(this._buildUrl());

    this._ws.onopen = () => {
      // A successful connection resets the backoff schedule.
      this._reconnectAttempts = 0;
      this._announce(true);
    };

    this._ws.onmessage = (event) => {
      this._dispatch(event.data);
    };

    this._ws.onclose = () => {
      this._announce(false);

      if (!this._closedByUser) {
        this._scheduleReconnect();
      }
    };

    this._ws.onerror = () => {
      // Force the close path; onclose owns the reconnect decision.
      this._ws?.close();
    };
  }

  /** Stop for good: cancels any pending reconnect and closes the socket. */
  disconnect(): void {
    this._closedByUser = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._ws?.close();
    this._ws = null;
  }

  // ─── Listener API ────────────────────────────────────

  /** Register a listener; returns the matching unsubscribe function. */
  subscribe(listener: WsListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  unsubscribe(listener: WsListener): void {
    this._listeners.delete(listener);
  }

  /**
   * Register a listener for the CONNECTION itself: `true` on open, `false`
   * on close, every time. Returns the matching unsubscribe function.
   *
   * Without this a consumer cannot tell "nothing new has arrived" from "I
   * stopped being told", because the reconnect is silent by design. Anything
   * that shows a live indicator needs the difference; the reconnect loop
   * keeps running either way.
   */
  onStatus(listener: WsStatusListener): () => void {
    this._statusListeners.add(listener);
    return () => {
      this._statusListeners.delete(listener);
    };
  }

  /** True while the socket is open. */
  get connected(): boolean {
    return this._connected;
  }

  // ─── Internals ───────────────────────────────────────

  /** Tell the status listeners, but only when the state actually changed. */
  private _announce(connected: boolean): void {
    if (this._connected === connected) {
      return;
    }

    this._connected = connected;

    for (const listener of this._statusListeners) {
      try {
        listener(connected);
      } catch {
        // A listener that throws must not break the socket, and must not
        // stop the listeners after it.
      }
    }
  }

  private _buildUrl(): string {
    const token = this._options.token?.();
    if (!token) {
      return this._options.url;
    }

    const separator = this._options.url.includes('?') ? '&' : '?';
    return `${this._options.url}${separator}token=${encodeURIComponent(token)}`;
  }

  private _dispatch(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      // Not JSON — a broken frame is not worth crashing listeners over.
      return;
    }

    if (!isWsEvent(parsed)) {
      return;
    }

    for (const listener of this._listeners) {
      listener(parsed);
    }
  }

  private _scheduleReconnect(): void {
    if (this._reconnectTimer) {
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, … capped at 30s.
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this._reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    this._reconnectAttempts += 1;

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
