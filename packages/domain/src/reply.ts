/**
 * reply.ts — Reply/forward resolution and quoted-body construction.
 *
 * Extracted from bermail packages/web/src/components/mail.tsx (the
 * handleReplyMessage counterparty logic, ~line 110) and compose-pane.tsx
 * (the Gmail-style quote/forward HTML). The UI keeps only wiring; every
 * decision about WHO a reply goes to and WHAT the quoted body looks like
 * lives here, where it can be unit-tested.
 *
 * Pure functions: no React, no fetch, no Date.now() — dates come in as
 * strings and formatting is deterministic given the input.
 */

import type { FullMessage } from '@bmail/contract';

import { extractAddress, splitAddressList } from './addresses.js';

// ─── Types ─────────────────────────────────────────────

/** The slice of a message that reply resolution needs. */
export type ReplyableMessage = Pick<
  FullMessage,
  'from' | 'to' | 'subject' | 'messageId' | 'date'
>;

/** What the composer needs to open a reply. */
export interface ReplyRecipients {
  /** Comma-separated "Name <addr>" list to put in the To field. */
  to: string;
  /** Message-ID to thread the reply under, when known. */
  inReplyTo?: string;
}

// ─── Reply resolution ──────────────────────────────────

/**
 * Decide who a reply to `selected` goes to.
 *
 * The subtle case (bermail commits 7ebf723 / 066f77d): replying to MY OWN
 * message — including a self-addressed one where from AND to are both me —
 * must target the thread counterparty, never bounce back to me.
 *
 *   1. If the selected message is mine, retarget to the latest thread
 *      message written by someone else.
 *   2. Reply target not mine → reply to its `from`.
 *   3. Reply target still mine (whole thread is self-mail) → reply to its
 *      non-self recipients; as a last resort keep `to`, then `from`.
 *
 * `threadMessages` is the full conversation sorted by date ascending, as
 * the thread endpoint returns it.
 */
export function resolveReplyRecipients(
  selected: ReplyableMessage,
  threadMessages: readonly ReplyableMessage[],
  myEmail: string | undefined,
): ReplyRecipients {
  const mine = myEmail?.trim().toLowerCase();

  const isFromMe = (message: ReplyableMessage): boolean => {
    if (!mine) {
      return false;
    }
    return extractAddress(message.from) === mine;
  };

  // Step 1: if I wrote the selected message, aim at the counterparty —
  // the most recent thread message that someone else wrote.
  let target = selected;
  if (isFromMe(selected)) {
    const counterparty = [...threadMessages]
      .reverse()
      .find((message) => !isFromMe(message));

    if (counterparty) {
      target = counterparty;
    }
  }

  // Step 2/3: pick the recipients from the target.
  let to: string;
  if (!isFromMe(target)) {
    to = target.from;
  } else {
    // Whole thread is mine (self-mail): reply to whoever else was on the
    // To line; keep the original recipients as a fallback.
    const others = splitAddressList(target.to ?? '').filter(
      (recipient) => extractAddress(recipient) !== mine,
    );
    to = others.join(', ') || target.to || target.from;
  }

  return {
    to,
    inReplyTo: target.messageId ?? selected.messageId ?? undefined,
  };
}

// ─── Subjects ──────────────────────────────────────────

/** Prefix with "Re: " unless the subject already carries it. */
export function buildReplySubject(subject: string): string {
  return subject.startsWith('Re:') ? subject : `Re: ${subject}`;
}

/** Prefix with "Fwd: " unless the subject already carries it. */
export function buildForwardSubject(subject: string): string {
  return subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;
}

// ─── Quoted bodies ─────────────────────────────────────

/** What the quote builders need to know about the message being quoted. */
export interface QuoteSource {
  /** Raw "Name <addr>" of the original sender. */
  from: string;
  /** ISO date string of the original message, or null. */
  date: string | null;
  /** Subject of the original message (used by the forward header). */
  subject: string;
  /** The original body as HTML (already sanitized upstream). */
  html: string;
}

/** Minimal HTML escaping for text we interpolate into attribution lines. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** "Mon, Aug 25, 2026, 10:30 AM" — the Gmail-ish attribution date. */
function formatAttributionDate(isoDate: string | null): string {
  if (!isoDate) {
    return '';
  }
  return new Date(isoDate).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Name &lt;addr&gt;" pieces for the attribution line. */
function attributionSender(from: string): string {
  const name = from.replace(/<[^>]+>/g, '').trim();
  const address = from.match(/<([^>]+)>/)?.[1] || from;
  return `${escapeHtml(name)} &lt;${escapeHtml(address)}&gt;`;
}

/** Wrap an attribution line plus the original HTML in the gmail_quote shell. */
function wrapQuote(replyBodyHtml: string, attributionLine: string, quotedHtml: string): string {
  const attribution =
    `<div dir="ltr" class="gmail_attr" ` +
    `style="color:#888;font-size:12px;margin:16px 0 8px 0;">${attributionLine}</div>`;

  const blockquote =
    `<blockquote class="gmail_quote" ` +
    `style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex;">` +
    `${quotedHtml}</blockquote>`;

  return `${replyBodyHtml}<br><div class="gmail_quote">${attribution}${blockquote}</div>`;
}

/**
 * Gmail-style quoted reply:
 *
 *   <my new text>
 *   On Mon, Aug 25 2026, 10:30 AM, Name <addr> wrote:
 *   > original message
 */
export function buildQuotedBody(replyBodyHtml: string, source: QuoteSource): string {
  const attributionLine =
    `On ${formatAttributionDate(source.date)}, ${attributionSender(source.from)} wrote:`;

  return wrapQuote(replyBodyHtml, attributionLine, source.html);
}

/**
 * Gmail-style forwarded message, with the classic dashed header block.
 * `forwardTo` is what the user typed in the To field — it is part of the
 * header by convention ("To: ...").
 */
export function buildForwardBody(
  replyBodyHtml: string,
  source: QuoteSource,
  forwardTo: string,
): string {
  const attributionLine =
    `---------- Forwarded message ----------<br>` +
    `From: ${attributionSender(source.from)}<br>` +
    `Date: ${formatAttributionDate(source.date)}<br>` +
    `Subject: ${escapeHtml(source.subject)}<br>` +
    `To: ${escapeHtml(forwardTo)}`;

  return wrapQuote(replyBodyHtml, attributionLine, source.html);
}
