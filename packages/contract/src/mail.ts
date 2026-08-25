/**
 * mail.ts — Wire types for mailboxes and messages.
 *
 * This is THE canonical shape of what travels over the HTTP API and what the
 * repository/engine return. Before the monorepo these types were triplicated
 * (bermail db/repository.ts, core/imap.ts, web/types.ts) with small drifts:
 *
 *   - core/imap.ts used `date: Date | undefined`; the wire uses ISO strings,
 *     so here `date` is `string | null` (what db and web already used).
 *   - `folder` is optional because list endpoints annotate which folder a
 *     message came from when a thread spans folders (the "__sent__" marker).
 *
 * Rule: everything here must be JSON-serializable. No Date, no class, no I/O.
 */

// ─── Mailboxes ─────────────────────────────────────────

export interface MailboxInfo {
  /** IMAP path, e.g. "INBOX" or "Sent Items" */
  path: string;
  /** Human-readable name shown in the sidebar */
  name: string;
  /** Total message count reported for the folder */
  messages: number;
  /** Unseen count (computed from local rows, not the IMAP STATUS value) */
  unseen: number;
}

// ─── Attachments ───────────────────────────────────────

/**
 * Metadata for one attachment of a message. The bytes themselves are streamed
 * by a dedicated endpoint; the envelope/full-message payloads only carry this
 * descriptor. (New in the monorepo — attachments support is step 11.)
 */
export interface AttachmentInfo {
  /** Original filename as sent, e.g. "invoice.pdf" */
  filename: string;
  /** MIME type, e.g. "application/pdf" */
  contentType: string;
  /** Size in bytes */
  size: number;
  /** MIME part identifier used to fetch the bytes from the server */
  partId: string;
}

// ─── Messages ──────────────────────────────────────────

export interface MessageEnvelope {
  /** IMAP UID within its folder */
  uid: number;
  /** IMAP sequence number; 0 when the row comes from the local cache */
  seq: number;
  subject: string;
  /** Sender, as a raw "Name <addr>" string */
  from: string;
  /** ISO 8601 date string, or null when the message had no Date header */
  date: string | null;
  seen: boolean;
  hasAttachments: boolean;
  /** Short plain-text preview for the list view */
  preview?: string;
  /** Conversation key computed by the threading logic (JWZ-inspired) */
  threadId: string;
  /** AI-generated insight JSON (serialized EmailInsight), when processed */
  aiInsight?: string | null;
  /**
   * Folder the message lives in, when the endpoint mixes folders
   * (thread views use "__sent__" for copies pulled from other folders).
   */
  folder?: string;
}

export interface FullMessage extends MessageEnvelope {
  /** Recipients, raw comma-separated "Name <addr>" strings */
  to: string;
  cc: string;
  /** RFC 5322 Message-ID header, used for reply threading */
  messageId?: string | null;
  textBody: string;
  htmlBody: string;
  /** Present once the engine extracts attachment metadata (step 11) */
  attachments?: AttachmentInfo[];
}

// ─── Pagination ────────────────────────────────────────

export interface PaginatedMessages {
  data: MessageEnvelope[];
  total: number;
  page: number;
  pageSize: number;
}
