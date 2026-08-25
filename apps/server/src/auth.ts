/**
 * auth.ts — Session token plumbing and the requireAuth middleware.
 *
 * Two ways to present the SAME JWT:
 *   1. httpOnly `session` cookie — the browser flow (unchanged from bermail);
 *   2. `Authorization: Bearer <jwt>` — new, for native clients that cannot
 *      or should not use cookies. Login also returns the token in the body.
 *
 * The JWT carries only ids ({ sub: userId, sid }); the IMAP password lives
 * in the RAM-only SessionStore, never inside the token.
 */

import type { IncomingMessage } from 'node:http';

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import type { SessionStore, Session, UserManager, UserTrio } from '@bmail/engine';

// ─── Shapes ────────────────────────────────────────────

export const SESSION_COOKIE = 'session';

export interface SessionTokenPayload {
  /** userId */
  sub: string;
  /** session id — the key into the RAM SessionStore */
  sid: string;
}

/** Request enriched by requireAuth with the authenticated user's context. */
export interface AuthedRequest extends Request {
  userId?: string;
  email?: string;
  password?: string;
  trio?: UserTrio;
  session?: Session;
}

// ─── Token extraction ──────────────────────────────────

/**
 * Pull the JWT out of a request: bearer header first (an explicit header
 * beats an ambient cookie), then the httpOnly cookie.
 */
export function extractToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  if (authorization && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return (req as { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
}

/**
 * Same extraction for the raw HTTP upgrade request of a WebSocket handshake
 * (no Express, so cookies are parsed by hand here).
 */
export function extractTokenFromUpgrade(req: IncomingMessage): string | undefined {
  const authorization = req.headers.authorization;
  if (authorization && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return parseCookieHeader(req.headers.cookie)[SESSION_COOKIE];
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }

  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
    cookies[name] = value;
  }

  return cookies;
}

// ─── Token → live session ──────────────────────────────

/**
 * Verify a JWT and look up its live session. Returns null on any failure:
 * bad signature, expired token, or a session already evicted from RAM.
 */
export function resolveSession(
  token: string | undefined,
  secret: string,
  sessions: SessionStore,
): Session | null {
  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, secret) as SessionTokenPayload;
    return sessions.get(payload.sid) ?? null;
  } catch {
    return null;
  }
}

// ─── Middleware ────────────────────────────────────────

/**
 * Gate for everything under /api (except /api/auth and /api/health).
 * Attaches the user's identity and their warm IMAP trio to the request,
 * re-hydrating the trio if the idle reaper tore it down.
 */
export function makeRequireAuth(
  secret: string,
  sessions: SessionStore,
  users: UserManager,
) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const session = resolveSession(extractToken(req), secret, sessions);
    if (!session) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Re-hydrate the IMAP trio if it was idle-reaped since the last request.
    let trio = users.get(session.userId);
    if (!trio) {
      try {
        trio = await users.getOrCreate(session.userId, session.email, session.password);
      } catch {
        res.status(502).json({ error: 'Mailbox unavailable' });
        return;
      }
    }

    req.userId = session.userId;
    req.email = session.email;
    req.password = session.password;
    req.trio = trio;
    req.session = session;
    next();
  };
}
