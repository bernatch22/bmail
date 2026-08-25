/**
 * @bmail/core — the whole server-side mail engine in one package.
 *
 * It used to be four (@bmail/contract, domain, db, engine). They always
 * travelled together — nobody installs the threading logic without the IMAP
 * client — so they are now four FOLDERS of one package, and the layering
 * that mattered survives as a rule about which folder may import which:
 *
 *   types/  wire shapes, zero dependencies      → imported by everyone
 *   logic/  pure mail logic, zero I/O           → types
 *   store/  SQLite cache: schema + queries      → types, logic
 *   mail/   IMAP, sync, sending, sessions, AI   → types, logic, store
 *
 * Never the other way around. types/ importing from mail/ would put imapflow
 * behind every type import, which is precisely what the split avoided.
 *
 * Each folder is also reachable on its own subpath — `@bmail/core/types`,
 * `/logic`, `/store`, `/mail` — so a consumer that only needs the wire types
 * (the SDK, a mobile client) never pulls in sqlite or imapflow.
 */

export * from './types/index.js';
export * from './logic/index.js';
export * from './store/index.js';
export * from './mail/index.js';
