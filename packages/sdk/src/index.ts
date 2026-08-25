/**
 * @bmail/sdk — platform-agnostic SDK for the BMail HTTP API and its
 * realtime WebSocket channel.
 *
 * Everything environment-specific is injected: fetch, the WebSocket
 * constructor, the base URL, and the reaction to a 401 (onUnauthorized).
 * The package has zero runtime dependencies besides @bmail/core/types.
 */

export { BmailClient, BmailApiError, parseAttachmentFilename } from './client.js';
export { BmailSocket } from './socket.js';
export type { WsListener, BmailSocketOptions } from './socket.js';
export type {
  AuthMode,
  BmailClientOptions,
  DownloadedAttachment,
  FetchLike,
  FetchResponseLike,
  ListMessagesOptions,
  OutgoingAttachment,
  SendMessageParams,
  WebSocketConstructorLike,
  WebSocketLike,
} from './types.js';
