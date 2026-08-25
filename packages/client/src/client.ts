/**
 * client.ts — BmailClient, the HTTP half of the SDK.
 *
 * Migrated from bermail/packages/web/src/api.ts, with the browser-isms
 * removed: no hardcoded '/api' origin (baseUrl is injected), no global fetch
 * assumption (injectable), and no `window.location.href` on 401 (the host app
 * decides what "unauthorized" means through the onUnauthorized callback).
 *
 * Every method mirrors one server route; the shapes come from @bmail/contract.
 */

import type {
  AuthUser,
  FullMessage,
  MailboxInfo,
  PaginatedMessages,
} from '@bmail/contract';

import type {
  BmailClientOptions,
  DownloadedAttachment,
  FetchLike,
  FetchResponseLike,
  ListMessagesOptions,
  SendMessageParams,
} from './types.js';

import { BmailSocket } from './socket.js';

// ─── Error type ────────────────────────────────────────

/** Thrown for any non-2xx response; carries the HTTP status for callers. */
export class BmailApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BmailApiError';
    this.status = status;
  }
}

// ─── Client ────────────────────────────────────────────

export class BmailClient {
  private readonly _baseUrl: string;
  private readonly _fetch: FetchLike;
  private readonly _options: BmailClientOptions;
  private _token: string | null;

  constructor(options: BmailClientOptions) {
    // Normalize: no trailing slash, so path concatenation stays predictable.
    this._baseUrl = options.baseUrl.replace(/\/+$/, '');
    this._options = options;
    this._token = options.token ?? null;

    // Bind the default so calling it unbound does not lose its `this`
    // (native fetch throws "Illegal invocation" when detached in browsers).
    const injectedFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this._fetch = injectedFetch.bind(globalThis) as FetchLike;
  }

  // ─── Token management (bearer mode) ──────────────────

  /** Replace the bearer token (e.g. after an out-of-band refresh). */
  setToken(token: string | null): void {
    this._token = token;
  }

  get token(): string | null {
    return this._token;
  }

  // ─── Auth ────────────────────────────────────────────

  /**
   * Log in. In cookie mode the server sets the session cookie; in bearer
   * mode the response is expected to carry a `token`, which the client
   * captures for all subsequent requests.
   */
  async login(email: string, password: string): Promise<AuthUser> {
    const body = await this._requestJson<{ user: AuthUser; token?: string }>(
      'POST',
      '/api/auth/login',
      { email, password },
      // A 401 on login is "wrong password", not "session expired" — do not
      // fire the global onUnauthorized handler for it.
      { skipUnauthorizedHandler: true },
    );

    if (this._options.authMode === 'bearer' && body.token) {
      this._token = body.token;
    }
    return body.user;
  }

  /** Log out. Also drops the captured bearer token, if any. */
  async logout(): Promise<void> {
    await this._requestVoid('POST', '/api/auth/logout');
    this._token = null;
  }

  /** Current session user, or null when not authenticated. */
  async me(): Promise<AuthUser | null> {
    const response = await this._rawRequest('GET', '/api/auth/me');
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { user: AuthUser };
    return body.user;
  }

  // ─── Mailboxes and messages ──────────────────────────

  async listMailboxes(): Promise<MailboxInfo[]> {
    const body = await this._requestJson<{ data: MailboxInfo[] }>('GET', '/api/mailboxes');
    return body.data;
  }

  async listMessages(
    folder: string,
    options: ListMessagesOptions = {},
  ): Promise<PaginatedMessages> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 30;
    const path = `/api/mailboxes/${encodeURIComponent(folder)}/messages?page=${page}&limit=${limit}`;
    return this._requestJson<PaginatedMessages>('GET', path);
  }

  async getMessage(folder: string, uid: number): Promise<FullMessage> {
    const path = `/api/mailboxes/${encodeURIComponent(folder)}/messages/${uid}`;
    const body = await this._requestJson<{ data: FullMessage }>('GET', path);
    return body.data;
  }

  /** All messages of a conversation, across folders. */
  async getThread(threadId: string): Promise<FullMessage[]> {
    const path = `/api/thread?threadId=${encodeURIComponent(threadId)}`;
    const body = await this._requestJson<{ data: FullMessage[] }>('GET', path);
    return body.data;
  }

  // ─── Message actions ─────────────────────────────────

  /** Mark as read (seen=true) or unread (seen=false). */
  async markSeen(folder: string, uid: number, seen: boolean = true): Promise<void> {
    await this._messageAction(folder, uid, seen ? 'read' : 'unread');
  }

  /** Set or clear the \Flagged (star) flag. */
  async flag(folder: string, uid: number, flagged: boolean = true): Promise<void> {
    await this._messageAction(folder, uid, flagged ? 'flag' : 'unflag');
  }

  /** Move a message to another folder. */
  async move(folder: string, uid: number, destination: string): Promise<void> {
    const path = `/api/mailboxes/${encodeURIComponent(folder)}/messages/${uid}/move`;
    await this._requestVoid('POST', path, { destination });
  }

  /** Move to the Trash folder. */
  async trash(folder: string, uid: number): Promise<void> {
    await this._messageAction(folder, uid, 'trash');
  }

  /** Move to the Archive folder. */
  async archive(folder: string, uid: number): Promise<void> {
    await this._messageAction(folder, uid, 'archive');
  }

  /** Permanently delete a message (no trash stop — irreversible). */
  async delete(folder: string, uid: number): Promise<void> {
    const path = `/api/mailboxes/${encodeURIComponent(folder)}/messages/${uid}`;
    await this._requestVoid('DELETE', path);
  }

  // ─── Sending ─────────────────────────────────────────

  /**
   * Send a message. Attachments travel base64-encoded in the JSON body —
   * simple and platform-neutral; the server decodes before handing them to
   * the SMTP layer.
   */
  async send(params: SendMessageParams): Promise<{ message: FullMessage }> {
    return this._requestJson<{ message: FullMessage }>('POST', '/api/send', params);
  }

  // ─── Attachments ─────────────────────────────────────

  /**
   * Absolute URL of an attachment's bytes. Useful for cookie-mode consumers
   * that want the browser to stream/download it directly (an <a href>).
   * In bearer mode prefer downloadAttachment(), which sends the header.
   */
  getAttachmentUrl(folder: string, uid: number, partId: string): string {
    const encodedFolder = encodeURIComponent(folder);
    const encodedPart = encodeURIComponent(partId);
    return `${this._baseUrl}/api/mailboxes/${encodedFolder}/messages/${uid}/attachments/${encodedPart}`;
  }

  /**
   * Fetch an attachment's bytes through the authenticated channel and parse
   * filename/contentType out of the response headers.
   */
  async downloadAttachment(
    folder: string,
    uid: number,
    partId: string,
  ): Promise<DownloadedAttachment> {
    const encodedFolder = encodeURIComponent(folder);
    const encodedPart = encodeURIComponent(partId);
    const path = `/api/mailboxes/${encodedFolder}/messages/${uid}/attachments/${encodedPart}`;

    const response = await this._rawRequest('GET', path);
    if (!response.ok) {
      await this._throwFromErrorResponse(response, 'Download failed');
    }

    const contentType =
      response.headers.get('content-type') ?? 'application/octet-stream';
    const filename = parseAttachmentFilename(
      response.headers.get('content-disposition'),
    );
    const buffer = await response.arrayBuffer();

    return { filename, contentType, bytes: new Uint8Array(buffer) };
  }

  // ─── WebSocket ───────────────────────────────────────

  /**
   * Open the realtime channel. By default the URL is derived from baseUrl
   * (http→ws, https→wss, path /ws); pass wsUrl to override. In bearer mode
   * the token travels as a query parameter, since raw WebSocket handshakes
   * cannot carry an Authorization header on every platform.
   */
  connect(wsUrl?: string): BmailSocket {
    const url = wsUrl ?? this._deriveWsUrl();

    const socket = new BmailSocket({
      url,
      WebSocketImpl: this._options.WebSocketImpl,
      token: this._options.authMode === 'bearer' ? () => this._token : undefined,
    });
    socket.connect();
    return socket;
  }

  private _deriveWsUrl(): string {
    if (this._baseUrl === '') {
      // Same-origin relative base only makes sense in a browser; there the
      // host app should pass an explicit wsUrl (or an absolute baseUrl).
      throw new Error(
        'Cannot derive a WebSocket URL from an empty baseUrl; pass wsUrl to connect()',
      );
    }
    return this._baseUrl.replace(/^http/, 'ws') + '/ws';
  }

  // ─── Internal plumbing ───────────────────────────────

  /** POST to a no-body action sub-route: read/unread/flag/unflag/trash/archive. */
  private async _messageAction(folder: string, uid: number, action: string): Promise<void> {
    const path = `/api/mailboxes/${encodeURIComponent(folder)}/messages/${uid}/${action}`;
    await this._requestVoid('POST', path);
  }

  /**
   * The one place every request goes through: builds headers per auth mode,
   * and funnels 401s to onUnauthorized.
   */
  private async _rawRequest(
    method: string,
    path: string,
    body?: unknown,
    options: { skipUnauthorizedHandler?: boolean } = {},
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {};

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this._options.authMode === 'bearer' && this._token) {
      headers['Authorization'] = `Bearer ${this._token}`;
    }

    const response = await this._fetch(`${this._baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Cookie mode leans on the browser cookie jar; bearer mode explicitly
      // omits credentials so stale cookies can never shadow the token.
      credentials: this._options.authMode === 'cookie' ? 'include' : 'omit',
    });

    if (response.status === 401 && !options.skipUnauthorizedHandler) {
      this._options.onUnauthorized?.();
    }
    return response;
  }

  /** Request expecting a JSON body back; throws BmailApiError on non-2xx. */
  private async _requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { skipUnauthorizedHandler?: boolean } = {},
  ): Promise<T> {
    const response = await this._rawRequest(method, path, body, options);
    if (!response.ok) {
      await this._throwFromErrorResponse(response, 'Request failed');
    }
    return (await response.json()) as T;
  }

  /** Request where we only care about success/failure, not the body. */
  private async _requestVoid(method: string, path: string, body?: unknown): Promise<void> {
    const response = await this._rawRequest(method, path, body);
    if (!response.ok) {
      await this._throwFromErrorResponse(response, 'Request failed');
    }
  }

  /** Extract the server's { error } message when there is one. */
  private async _throwFromErrorResponse(
    response: FetchResponseLike,
    fallbackPrefix: string,
  ): Promise<never> {
    const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
    const message = parsed?.error ?? `${fallbackPrefix}: ${response.status} ${response.statusText}`;
    throw new BmailApiError(message, response.status);
  }
}

// ─── Helpers ───────────────────────────────────────────

/**
 * Pull the filename out of a Content-Disposition header. Handles both the
 * RFC 5987 `filename*=UTF-8''…` form and the plain quoted `filename="…"`.
 */
export function parseAttachmentFilename(header: string | null): string {
  if (!header) {
    return 'attachment';
  }

  // RFC 5987 extended form wins when present (it carries non-ASCII safely).
  const extended = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Malformed percent-encoding: fall through to the plain form.
    }
  }

  const plain = /filename="?([^";]+)"?/.exec(header);
  if (plain) {
    return plain[1].trim();
  }

  return 'attachment';
}
