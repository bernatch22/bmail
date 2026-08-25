/**
 * @bmail/contract — the single source of truth for shared wire types.
 *
 * Every other package (domain, db, engine, client, ui, apps) imports these
 * shapes from here instead of redeclaring them. This package has ZERO runtime
 * dependencies and almost zero runtime code: types plus tiny pure helpers.
 *
 * If you are about to copy one of these interfaces into another package:
 * don't. Import it. That triplication is exactly what this package replaces.
 */

export * from './mail.js';
export * from './insight.js';
export * from './ws.js';
export * from './auth.js';
