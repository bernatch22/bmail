/**
 * format.ts — Small presentation helpers shared by the mail components.
 *
 * Dates, initials, sender names, file sizes and the parsing of the
 * serialized AI insight. Everything here is about HOW things look;
 * address/reply semantics live in @bmail/domain.
 */

import type { EmailInsight, MessageEnvelope } from '@bmail/contract';

// ─── Dates ─────────────────────────────────────────────

/** "Mon, 25 Aug 2026, 10:30" — full header date of an expanded message. */
export function formatFullDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** "25 Aug, 10:30" — compact date for collapsed thread rows. */
export function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** "now" / "5m" / "3h" / "2d" / "25 Aug" — relative date for the list. */
export function formatRelativeDate(iso: string | null): string {
  if (!iso) return '';

  const date = new Date(iso);
  const elapsedMs = Date.now() - date.getTime();

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── People ────────────────────────────────────────────

/** Up to two initials for an avatar bubble: "Maria Macpherson" → "MM". */
export function getInitials(name: string): string {
  return name
    .split(/[\s,]+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/** Display name out of a raw "Name <addr>" string; the address as fallback. */
export function getSenderName(from: string): string {
  return from.replace(/<[^>]+>/g, '').trim() || from;
}

// ─── File sizes ────────────────────────────────────────

/** "1.4 MB" / "312 KB" / "87 B" — attachment chip size label. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── AI insight ────────────────────────────────────────

/** Parse the serialized EmailInsight riding on a message, if any. */
export function parseInsight(message: Pick<MessageEnvelope, 'aiInsight'>): EmailInsight | null {
  if (!message.aiInsight) return null;

  try {
    return JSON.parse(message.aiInsight) as EmailInsight;
  } catch {
    return null;
  }
}
