/**
 * index.ts — Public surface of the store: `@bmail/core/store`.
 *
 * Two halves, deliberately separate files: database.ts owns the connection
 * and the DDL, repository.ts owns the queries. Nothing here is a singleton —
 * open a database, hand it to a MailRepository, and you can run two stores
 * side by side (which is exactly what the tests do).
 */

export * from './database.js';
export * from './repository.js';
