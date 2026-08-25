/**
 * @bmail/engine — the heart of BMail, extracted from bermail's core.
 *
 * What lives here: IMAP access (ImapService/ImapMonitor), the IMAP→SQLite
 * SyncEngine, per-user lifecycle (UserManager, SessionStore), the message
 * operations behind the HTTP routes (MailService), outbound mail
 * (SmtpSender), the org registry, and the optional AI plugin
 * (InsightProvider / AnthropicInsightProvider).
 *
 * What does NOT live here, on purpose:
 *  - HTTP routes and Express wiring → apps/server (step 5)
 *  - The WebSocket hub: the engine only knows the ChangeNotifier interface;
 *    the ws-backed implementation is server wiring → apps/server
 *  - Dead Outlook/MSAL code from bermail (mail-sender, auth, ws-handler,
 *    cli) — deliberately not migrated
 */

export * from './org-registry.js';
export * from './imap-service.js';
export * from './imap-monitor.js';
export * from './sync-engine.js';
export * from './session-store.js';
export * from './user-manager.js';
export * from './mail-service.js';
export * from './smtp-sender.js';
export * from './change-notifier.js';
export * from './insight-provider.js';
export * from './anthropic-insight-provider.js';
