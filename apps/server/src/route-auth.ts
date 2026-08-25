/**
 * route-auth.ts — /api/auth/login, /logout, /me.
 *
 * Credentials are validated against Maddy IMAP (verifyImapCredentials); no
 * password store exists anywhere. Login sets the httpOnly cookie AND returns
 * the same JWT in the body, so native clients can switch to bearer auth
 * without a second endpoint.
 */

import crypto from 'node:crypto';

import { Router } from 'express';
import type { Request, Response, Router as ExpressRouter } from 'express';
import jwt from 'jsonwebtoken';

import {
  emailToUserId,
  verifyImapCredentials,
  type OrgRegistry,
  type SessionStore,
  type UserManager,
} from '@bmail/engine';

import { SESSION_COOKIE, extractToken, resolveSession } from './auth.js';

// ─── Cookie policy ─────────────────────────────────────

const SESSION_LIFETIME_MS = 12 * 3600 * 1000;
const isProduction = process.env.NODE_ENV === 'production';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    maxAge: SESSION_LIFETIME_MS,
    path: '/',
  };
}

// ─── Routes ────────────────────────────────────────────

export function createAuthRoutes(
  secret: string,
  orgRegistry: OrgRegistry,
  sessions: SessionStore,
  users: UserManager,
): ExpressRouter {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const org = orgRegistry.getOrgForEmail(email);
    if (!org) {
      res.status(403).json({ error: 'This email domain is not allowed' });
      return;
    }

    const credentialsOk = await verifyImapCredentials(orgRegistry, email, password);
    if (!credentialsOk) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const userId = emailToUserId(email);
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.create(sid, userId, email, password, org.name);

    // Warm the mailbox (first sync) so the inbox is ready on first load.
    // A failure here is not fatal: requireAuth retries on the next request.
    try {
      await users.getOrCreate(userId, email, password);
    } catch {
      // Middleware will re-hydrate the trio later.
    }

    const token = jwt.sign({ sub: userId, sid }, secret, { expiresIn: '12h' });

    // Cookie for browsers, token in the body for native/bearer clients.
    res.cookie(SESSION_COOKIE, token, cookieOptions());
    res.json({ user: { email, org: org.name }, token });
  });

  router.get('/me', (req: Request, res: Response) => {
    const session = resolveSession(extractToken(req), secret, sessions);
    if (!session) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({ user: { email: session.email, org: session.org } });
  });

  router.post('/logout', async (req: Request, res: Response) => {
    const session = resolveSession(extractToken(req), secret, sessions);
    if (session) {
      sessions.delete(session.sid);
      await users.teardown(session.userId).catch(() => {});
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  return router;
}
