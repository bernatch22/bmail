/**
 * validate.ts — input validation shared by every infra operation.
 *
 * Emails and domains reach these operations from CLIs, APIs and agents, and
 * they are interpolated into remote shell commands and AWS calls — so they
 * are validated and normalized (lowercased) at the boundary, once.
 */

// ── patterns ──────────────────────────────────────────────────────────────────

export const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export const DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

// ── validators ────────────────────────────────────────────────────────────────

// Throw unless value looks like an email; returns it lowercased.
export function requireEmail(value: string | undefined): string {
  if (!value || !EMAIL_PATTERN.test(value)) {
    throw new Error(`invalid email: ${value || '(missing)'}`);
  }

  return value.toLowerCase();
}

// Throw unless value looks like a bare domain; returns it lowercased.
export function requireDomain(value: string | undefined): string {
  if (!value || !DOMAIN_PATTERN.test(value)) {
    throw new Error(`invalid domain: ${value || '(missing)'}`);
  }

  return value.toLowerCase();
}
