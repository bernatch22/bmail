/**
 * addresses.ts — Parsing and formatting of RFC-style mailbox strings.
 *
 * The whole system passes addresses around as raw strings ("Name <addr>" or
 * bare "addr", comma-separated for lists) because that is what IMAP envelopes
 * and the DB rows store. Before the monorepo, every consumer re-implemented
 * the same regex inline (web/components/mail.tsx `addrOf`, compose-pane.tsx
 * sender extraction). This module is the single home for that logic.
 *
 * Pure functions only: no I/O, no dependencies beyond the standard library.
 */

// ─── Types ─────────────────────────────────────────────

/** A single parsed mailbox: display name (may be empty) plus bare address. */
export interface ParsedAddress {
  /** Display name without quotes, e.g. "Maria Macpherson". Empty when absent. */
  name: string;
  /** Bare email address, lowercased, e.g. "maria@example.com". */
  address: string;
}

// ─── Parsing ───────────────────────────────────────────

/**
 * Parse one mailbox string into { name, address }.
 *
 * Accepts the two shapes we actually see on the wire:
 *   'Maria Macpherson <maria@example.com>'  → name + address
 *   '"Maria, M." <maria@example.com>'       → quoted name (quotes stripped)
 *   'maria@example.com'                     → bare address, empty name
 *
 * The address is lowercased because every comparison in the app
 * (self-detection, counterparty resolution) is case-insensitive.
 */
export function parseAddress(raw: string): ParsedAddress {
  const trimmed = raw.trim();

  const angleMatch = trimmed.match(/^(.*)<([^>]+)>\s*$/);
  if (angleMatch) {
    // Strip surrounding quotes from the display-name part, if any.
    const name = angleMatch[1].trim().replace(/^"(.*)"$/, '$1').trim();
    const address = angleMatch[2].trim().toLowerCase();
    return { name, address };
  }

  // No angle brackets: the whole string is the address.
  return { name: '', address: trimmed.toLowerCase() };
}

/**
 * Extract just the bare address from a mailbox string.
 * This is the `addrOf` helper that lived inline in web/mail.tsx.
 */
export function extractAddress(raw: string): string {
  return parseAddress(raw).address;
}

/**
 * Split a comma-separated header value into individual mailbox strings.
 *
 * Commas inside double quotes ('"Doe, Jane" <j@x.com>') and inside angle
 * brackets are NOT separators. Returns the raw per-mailbox strings, trimmed,
 * empty entries dropped — parse each with parseAddress() if needed.
 */
export function splitAddressList(rawList: string): string[] {
  const parts: string[] = [];
  let current = '';
  let insideQuotes = false;
  let insideAngle = false;

  for (const char of rawList) {
    if (char === '"') insideQuotes = !insideQuotes;
    if (char === '<') insideAngle = true;
    if (char === '>') insideAngle = false;

    if (char === ',' && !insideQuotes && !insideAngle) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Parse a whole comma-separated list into ParsedAddress entries. */
export function parseAddressList(rawList: string): ParsedAddress[] {
  return splitAddressList(rawList).map(parseAddress);
}

// ─── Formatting ────────────────────────────────────────

/**
 * Format back to the wire shape: 'Name <addr>' when a name exists,
 * bare address otherwise. Names containing a comma or quotes get quoted,
 * so the result survives a later splitAddressList() round-trip.
 */
export function formatAddress(parsed: ParsedAddress): string {
  if (!parsed.name) {
    return parsed.address;
  }

  const needsQuoting = /[,"<>]/.test(parsed.name);
  const displayName = needsQuoting
    ? `"${parsed.name.replace(/"/g, '\\"')}"`
    : parsed.name;

  return `${displayName} <${parsed.address}>`;
}

// ─── Predicates and pieces ─────────────────────────────

/**
 * The domain part of an address ("maria@example.com" → "example.com").
 * Accepts a full mailbox string too. Empty string when there is no '@'.
 */
export function extractDomain(raw: string): string {
  const address = extractAddress(raw);
  const atIndex = address.lastIndexOf('@');

  if (atIndex === -1) {
    return '';
  }
  return address.slice(atIndex + 1);
}

/**
 * True when a message is self-addressed: both `from` and every `to` recipient
 * resolve to my own address. This is the case that broke reply resolution in
 * bermail (commit 7ebf723): replying to such a message must target the thread
 * counterparty, never myself.
 */
export function isSelfAddressed(
  from: string,
  to: string,
  myEmail: string,
): boolean {
  const mine = myEmail.trim().toLowerCase();
  if (!mine) {
    return false;
  }

  if (extractAddress(from) !== mine) {
    return false;
  }

  const recipients = splitAddressList(to);
  if (recipients.length === 0) {
    // From me, with no recipients at all — treat as self-addressed.
    return true;
  }
  return recipients.every((r) => extractAddress(r) === mine);
}
