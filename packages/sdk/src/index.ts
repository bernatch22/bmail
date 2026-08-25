/**
 * @bernatch22/bmail — platform-agnostic SDK for the BMail HTTP API and its
 * realtime WebSocket channel.
 *
 * Everything environment-specific is injected: fetch, the WebSocket
 * constructor, the base URL, and the reaction to a 401 (onUnauthorized).
 * The package has zero runtime dependencies besides @bmail/core/types.
 */

export { BmailClient, BmailApiError, parseAttachmentFilename } from './client.js';
export { BmailSocket } from './socket.js';
export type { WsListener, BmailSocketOptions } from './socket.js';

/**
 * LOS TIPOS DEL CONTRATO, re-exportados.
 *
 * Están en las firmas de todos los métodos —`listMailboxes()` devuelve
 * `MailboxInfo[]`— así que sin esta línea el consumidor recibe los objetos y
 * NO PUEDE NOMBRAR SU TIPO: `import { MailboxInfo }` falla con «declares it
 * locally, but it is not exported». Se vio instalando el tarball en un
 * proyecto vacío antes de publicar, que es la única forma de verlo.
 */
export type {
  AttachmentInfo,
  AuthUser,
  EmailInsight,
  FullMessage,
  MailboxInfo,
  MessageEnvelope,
  PaginatedMessages,
  WsEvent,
  WsEventType,
} from '@bmail/core/types';

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
