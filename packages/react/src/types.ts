/**
 * types.ts — Shapes shared by the @bmail/react components and their host app.
 *
 * The components are presentation-only: they never fetch. These types are
 * the vocabulary of the props/callbacks contract between UI and app.
 */

// ─── Theme ─────────────────────────────────────────────

export type Theme = 'light' | 'dark';

// ─── Compose ───────────────────────────────────────────

/** What the composer opens with: mode plus pre-filled fields. */
export interface ComposeDraft {
  mode: 'reply' | 'forward' | 'new';
  to: string;
  cc: string;
  subject: string;
  body: string;
  /** Original message HTML to quote below the new text (reply/forward). */
  quotedHtml: string;
  /** Message-ID being replied to, for the In-Reply-To header. */
  inReplyTo?: string;
  /** The message being replied to / forwarded (attribution + threading). */
  source?: {
    from: string;
    date: string | null;
    subject: string;
    threadId: string;
  };
}

/**
 * What the composer hands back on Send. The quoted HTML is already built
 * (via @bmail/core/logic); attachments travel as raw File objects — encoding
 * them to base64 for the wire is the app layer's job.
 */
export interface ComposeSubmission {
  to: string;
  cc?: string;
  subject: string;
  html?: string;
  text?: string;
  threadId?: string;
  inReplyTo?: string;
  files: File[];
}
