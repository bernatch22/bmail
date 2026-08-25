/**
 * index.ts — Public surface of the pure mail logic: `@bmail/core/logic`.
 *
 * Zero I/O, only dependency ../types.
 * Everything here is re-exported from focused modules:
 *
 *   threading  — subject normalization + JWZ-inspired thread id computation
 *   reply      — reply/forward recipient resolution and quoted-body HTML
 *   addresses  — "Name <addr>" parsing/formatting, self-address detection
 *   folders    — URL slug ↔ IMAP folder path mapping (Maddy folder set)
 */

export * from './threading.js';
export * from './reply.js';
export * from './addresses.js';
export * from './folders.js';
