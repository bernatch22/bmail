/**
 * folders.ts — Mapping between clean URL slugs and IMAP folder paths.
 *
 * Extracted from bermail packages/web/src/router.tsx. The web app shows
 * "/inbox", "/trash" in the URL bar while the server speaks IMAP paths.
 * The folder names are the ones Maddy provisions per mailbox:
 * INBOX, Drafts, Sent, Junk, Trash, Archive.
 *
 * Pure data + two total functions; unknown values pass through so a custom
 * IMAP folder still gets a usable (if uglier) slug.
 */

// ─── The canonical Maddy folder set ────────────────────

/** IMAP paths Maddy creates for every mailbox, in sidebar order. */
export const MADDY_FOLDERS = [
  'INBOX',
  'Drafts',
  'Sent',
  'Junk',
  'Trash',
  'Archive',
] as const;

export type MaddyFolder = (typeof MADDY_FOLDERS)[number];

// ─── Slug maps ─────────────────────────────────────────

/** URL slug → IMAP folder path. */
export const FOLDER_SLUGS: Record<string, string> = {
  inbox: 'INBOX',
  drafts: 'Drafts',
  sent: 'Sent',
  junk: 'Junk',
  trash: 'Trash',
  archive: 'Archive',
};

/** IMAP folder path → URL slug (derived, kept in lockstep). */
export const FOLDER_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(FOLDER_SLUGS).map(([slug, path]) => [path, slug]),
);

// ─── Conversions ───────────────────────────────────────

/**
 * IMAP path → slug. Unknown folders degrade to a lowercased, dash-joined
 * slug ("Sent Items" → "sent-items") so deep links still work.
 */
export function folderToSlug(imapPath: string): string {
  return FOLDER_TO_SLUG[imapPath] ?? imapPath.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Slug → IMAP path. Unknown slugs pass through unchanged — the server will
 * reject a folder that does not exist, which is the right failure mode.
 */
export function slugToFolder(slug: string): string {
  return FOLDER_SLUGS[slug] ?? slug;
}
