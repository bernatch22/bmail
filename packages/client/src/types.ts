/**
 * types.ts — Public option/result shapes of the @bmail/client SDK.
 *
 * The client is platform-agnostic: it never touches window, document or any
 * DOM API. Everything environment-specific (fetch, WebSocket, base URL, what
 * to do on a 401) is injected through these options, so the same SDK runs in
 * a browser, in Node and in React Native.
 */

import type { AttachmentInfo } from '@bmail/contract';

// ─── Injectable primitives ─────────────────────────────

/**
 * Minimal fetch signature. Structurally compatible with the standard
 * `globalThis.fetch` of browsers, Node >= 18 and React Native, without
 * dragging DOM lib types into consumers.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: 'include' | 'omit' | 'same-origin';
  },
) => Promise<FetchResponseLike>;

/** The subset of the Response interface the SDK actually uses. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Minimal WebSocket constructor + instance, structurally compatible with the
 * browser WebSocket, React Native's, and the `ws` package in Node. Only the
 * event-handler properties are required — no addEventListener, so the `ws`
 * package (which also exposes onmessage/onclose/onerror) fits as-is.
 */
export interface WebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

export type WebSocketConstructorLike = new (url: string) => WebSocketLike;

// ─── Client options ────────────────────────────────────

/**
 * Auth transport:
 *   - 'cookie': the session travels in an HTTP cookie; every request is made
 *     with credentials:'include'. This is what the web SPA uses.
 *   - 'bearer': the session travels in an `Authorization: Bearer <token>`
 *     header and cookies are never relied on. This is what mobile/CLI use.
 */
export type AuthMode = 'cookie' | 'bearer';

export interface BmailClientOptions {
  /** API origin, e.g. "https://mail.example.com" or "" for same-origin. */
  baseUrl: string;

  /** Fetch implementation; defaults to globalThis.fetch. */
  fetch?: FetchLike;

  /** WebSocket constructor; defaults to globalThis.WebSocket. */
  WebSocketImpl?: WebSocketConstructorLike;

  authMode: AuthMode;

  /** Initial bearer token (bearer mode only; login() also captures one). */
  token?: string;

  /**
   * Called on any 401 response. The SDK itself performs NO navigation — the
   * old web api.ts did `window.location.href = '/login'` here, which is a
   * host-app decision, not an SDK one.
   */
  onUnauthorized?: () => void;
}

// ─── Request/response payloads ─────────────────────────

/** One attachment to include in an outgoing message. */
export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  /** File bytes, base64-encoded (JSON-friendly on every platform). */
  contentBase64: string;
}

export interface SendMessageParams {
  to: string;
  cc?: string;
  subject: string;
  html?: string;
  text?: string;
  /** Set when replying, so the server threads the copy correctly. */
  threadId?: string;
  /** Message-ID being replied to, for the In-Reply-To header. */
  inReplyTo?: string;
  attachments?: OutgoingAttachment[];
}

export interface ListMessagesOptions {
  page?: number;
  limit?: number;
}

/** A downloaded attachment, parsed from the raw HTTP response. */
export interface DownloadedAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

// Re-exported for convenience so consumers rarely need @bmail/contract
// directly when working with downloads.
export type { AttachmentInfo };
