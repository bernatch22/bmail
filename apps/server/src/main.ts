/**
 * main.ts — BMail API server entry point.
 *
 * Thin wiring only: build the engine pieces (db, org registry, sessions,
 * user manager, smtp sender, optional AI provider), mount the routes, and
 * bridge the WebSocket upgrade to the WsHub. All mail behavior lives in
 * @bmail/core — a handler here should never be more than parse → call →
 * serialize.
 *
 * Auth: users log in with email/password validated against Maddy IMAP.
 * Each logged-in user gets their own IMAP/monitor/sync trio (UserManager).
 * All /api/* routes and the /ws socket are scoped to the authenticated user,
 * via httpOnly cookie or Authorization: Bearer (same JWT).
 */

import { createServer } from 'node:http';

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';

import { openDefaultDatabase } from '@bmail/core/store';
import { MailRepository } from '@bmail/core/store';
import {
  AnthropicInsightProvider,
  DisplayNameResolver,
  OrgRegistry,
  SessionStore,
  SmtpSender,
  UserManager,
  type InsightProvider,
} from '@bmail/core';

import { loadServerConfig } from './config.js';
import { WsHub } from './ws-hub.js';
import { makeRequireAuth, extractTokenFromUpgrade, resolveSession } from './auth.js';
import type { AuthedRequest } from './auth.js';
import { createAuthRoutes } from './route-auth.js';
import { createMailboxRoutes } from './route-mailboxes.js';
import { createSendRoute } from './route-send.js';

async function main(): Promise<void> {
  console.log('\n  BMail API — multi-user');
  console.log('  ──────────────────────────────');

  // Fails fast with a clear message when SESSION_SECRET is missing.
  const config = loadServerConfig();

  // ─── Engine wiring ───────────────────────────────────

  const database = openDefaultDatabase();
  const repository = new MailRepository(database);

  // Org registry: JSON file when configured, the production fixture otherwise.
  const orgRegistry = config.orgsFile
    ? OrgRegistry.fromJsonFile(config.orgsFile)
    : new OrgRegistry();

  // AI enrichment is optional: no key, no provider, zero AI work.
  let insightProvider: InsightProvider | undefined;
  if (config.anthropicApiKey) {
    insightProvider = new AnthropicInsightProvider();
    console.log('  ✓ AI insights enabled (Anthropic)');
  }

  const wsHub = new WsHub();
  const sessions = new SessionStore();
  const users = new UserManager({
    repository,
    orgRegistry,
    notifier: wsHub,
    insightProvider,
  });
  users.startReaper();

  const smtpSender = new SmtpSender(orgRegistry, new DisplayNameResolver());

  // ─── HTTP app ────────────────────────────────────────

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '25mb' })); // room for base64 attachments
  app.use(cookieParser());

  // Public: liveness (no account info leaked).
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // Public: auth.
  app.use('/api/auth', createAuthRoutes(config.sessionSecret, orgRegistry, sessions, users));

  // Everything below requires a valid session (cookie or bearer).
  const requireAuth = makeRequireAuth(config.sessionSecret, sessions, users);
  app.use('/api', requireAuth);

  app.use('/api/mailboxes', createMailboxRoutes(repository));

  app.get('/api/search', (req: AuthedRequest, res) => {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: 'Missing query parameter: q' });
      return;
    }
    res.json({ data: repository.searchMessages(req.userId!, query) });
  });

  app.get('/api/thread', (req: AuthedRequest, res) => {
    const threadId = req.query.threadId as string;
    if (!threadId) {
      res.status(400).json({ error: 'Missing query parameter: threadId' });
      return;
    }
    res.json({ data: repository.getThreadMessages(req.userId!, threadId) });
  });

  app.post('/api/sync', async (req: AuthedRequest, res) => {
    try {
      await req.trio!.sync.incrementalSync();
      res.json({ status: 'synced' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      res.status(500).json({ error: message });
    }
  });

  // Send AS the logged-in user via Maddy submission → SES relay.
  app.use('/api/send', createSendRoute(smtpSender));

  // ─── WebSocket upgrade ───────────────────────────────

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/ws')) {
      socket.destroy();
      return;
    }

    // Same JWT as HTTP: session cookie (browsers) or bearer header (native).
    const token = extractTokenFromUpgrade(req);
    const session = resolveSession(token, config.sessionSecret, sessions);

    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wsHub.add(session.userId, ws);
      ws.send(
        JSON.stringify({
          type: 'connected',
          payload: { timestamp: new Date().toISOString() },
        }),
      );
    });
  });

  // ─── Lifecycle ───────────────────────────────────────

  const shutdown = (): void => {
    console.log('\n  Shutting down...');
    database.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGUSR2', shutdown);

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`  ✗ Port ${config.port} already in use — refusing to start.`);
      process.exit(1);
    }
    throw error;
  });

  server.listen(config.port, () => {
    console.log(`\n  ✓ API:  http://localhost:${config.port}/api`);
    console.log(`  ✓ WS:   ws://localhost:${config.port}/ws`);
    console.log('  ✓ Auth: email/password via Maddy IMAP — cookie or bearer JWT\n');
  });
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});
