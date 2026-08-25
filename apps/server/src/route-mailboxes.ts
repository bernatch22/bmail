/**
 * route-mailboxes.ts — Mailbox, message and attachment routes.
 *
 * Every handler is parse-request → engine call → serialize. The message
 * choreography that bermail inlined per endpoint (IMAP action + local
 * mirror) now lives in MailService, so these handlers stay one call deep.
 */

import { Router } from 'express';
import type { Response, Router as ExpressRouter } from 'express';

import type { MailRepository } from '@bmail/db/repository';

import type { AuthedRequest } from './auth.js';

// ─── Shared plumbing ───────────────────────────────────

/** Uniform 500 with the real error message (same policy as bermail). */
function respondWithError(res: Response, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;
  res.status(500).json({ error: message });
}

/** Parse the :folder/:uid pair every message route shares. */
function parseMessagePath(req: AuthedRequest): { folder: string; uid: number } {
  return {
    folder: decodeURIComponent(req.params.folder),
    uid: parseInt(req.params.uid, 10),
  };
}

/**
 * RFC 5987 Content-Disposition for arbitrary (possibly non-ASCII) filenames:
 * an ASCII-safe fallback plus the UTF-8 `filename*` form modern clients use.
 */
function attachmentContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const utf8Encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

// ─── Routes ────────────────────────────────────────────

export function createMailboxRoutes(repository: MailRepository): ExpressRouter {
  const router = Router();

  // List folders (100% local store).
  router.get('/', (req: AuthedRequest, res: Response) => {
    try {
      res.json({ data: repository.getFolders(req.userId!) });
    } catch (error: unknown) {
      respondWithError(res, error, 'Failed to list mailboxes');
    }
  });

  // List messages in a folder, paginated (100% local store).
  router.get('/:folder/messages', (req: AuthedRequest, res: Response) => {
    try {
      const folder = decodeURIComponent(req.params.folder);
      const page = parseInt((req.query.page as string) ?? '1', 10);
      const limit = parseInt((req.query.limit as string) ?? '30', 10);

      res.json(req.trio!.mail.listMessages(folder, limit, page));
    } catch (error: unknown) {
      respondWithError(res, error, 'Failed to list messages');
    }
  });

  // Get one full message (lazy IMAP body fetch + mark seen inside the engine).
  router.get('/:folder/messages/:uid', async (req: AuthedRequest, res: Response) => {
    try {
      const { folder, uid } = parseMessagePath(req);
      if (isNaN(uid)) {
        res.status(400).json({ error: 'Invalid UID' });
        return;
      }

      const message = await req.trio!.mail.getMessage(folder, uid);
      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      res.json({ data: message });
    } catch (error: unknown) {
      respondWithError(res, error, 'Failed to get message');
    }
  });

  // ─── Attachments (step 11) ───────────────────────────

  // Download one attachment's bytes. partId comes from the AttachmentInfo
  // list returned by GET message.
  router.get(
    '/:folder/messages/:uid/attachments/:partId',
    async (req: AuthedRequest, res: Response) => {
      try {
        const { folder, uid } = parseMessagePath(req);
        if (isNaN(uid)) {
          res.status(400).json({ error: 'Invalid UID' });
          return;
        }

        const attachment = await req.trio!.mail.getAttachment(folder, uid, req.params.partId);
        if (!attachment) {
          res.status(404).json({ error: 'Attachment not found' });
          return;
        }

        res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', attachmentContentDisposition(attachment.filename));
        res.setHeader('Content-Length', attachment.content.length);
        res.end(attachment.content);
      } catch (error: unknown) {
        respondWithError(res, error, 'Failed to download attachment');
      }
    },
  );

  // ─── Message actions ─────────────────────────────────
  //
  // Every action shares the exact shape: parse the path, call ONE MailService
  // method, answer { status: 'ok' }. Declared as a table instead of six
  // copy-pasted handlers.

  const actions: Array<{
    path: string;
    fallback: string;
    perform: (req: AuthedRequest, folder: string, uid: number) => Promise<void>;
  }> = [
    {
      path: 'trash',
      fallback: 'Failed to trash message',
      perform: (req, folder, uid) => req.trio!.mail.trash(folder, uid),
    },
    {
      path: 'archive',
      fallback: 'Failed to archive message',
      perform: (req, folder, uid) => req.trio!.mail.archive(folder, uid),
    },
    {
      path: 'flag',
      fallback: 'Failed to flag message',
      perform: (req, folder, uid) => req.trio!.mail.flag(folder, uid),
    },
    {
      path: 'unflag',
      fallback: 'Failed to unflag message',
      perform: (req, folder, uid) => req.trio!.mail.unflag(folder, uid),
    },
    {
      path: 'read',
      fallback: 'Failed to mark read',
      perform: (req, folder, uid) => req.trio!.mail.markSeen(folder, uid),
    },
    {
      path: 'unread',
      fallback: 'Failed to mark unread',
      perform: (req, folder, uid) => req.trio!.mail.markUnseen(folder, uid),
    },
  ];

  for (const action of actions) {
    router.post(
      `/:folder/messages/:uid/${action.path}`,
      async (req: AuthedRequest, res: Response) => {
        try {
          const { folder, uid } = parseMessagePath(req);
          if (isNaN(uid)) {
            res.status(400).json({ error: 'Invalid UID' });
            return;
          }

          await action.perform(req, folder, uid);
          res.json({ status: 'ok' });
        } catch (error: unknown) {
          respondWithError(res, error, action.fallback);
        }
      },
    );
  }

  // ─── Move and delete ───────────────────────────────────
  //
  // These two are not in the uniform action table above: move needs a body
  // parameter (the destination folder) and delete uses the HTTP verb on the
  // message resource itself, matching what the @bmail/client SDK expects.

  router.post(
    '/:folder/messages/:uid/move',
    async (req: AuthedRequest, res: Response) => {
      try {
        const { folder, uid } = parseMessagePath(req);
        if (isNaN(uid)) {
          res.status(400).json({ error: 'Invalid UID' });
          return;
        }

        const destination = (req.body as { destination?: string })?.destination;
        if (!destination || typeof destination !== 'string') {
          res.status(400).json({ error: 'Missing destination folder' });
          return;
        }

        await req.trio!.mail.move(folder, uid, destination);
        res.json({ status: 'ok' });
      } catch (error: unknown) {
        respondWithError(res, error, 'Failed to move message');
      }
    },
  );

  router.delete(
    '/:folder/messages/:uid',
    async (req: AuthedRequest, res: Response) => {
      try {
        const { folder, uid } = parseMessagePath(req);
        if (isNaN(uid)) {
          res.status(400).json({ error: 'Invalid UID' });
          return;
        }

        req.trio!.mail.delete(folder, uid);
        res.json({ status: 'ok' });
      } catch (error: unknown) {
        respondWithError(res, error, 'Failed to delete message');
      }
    },
  );

  return router;
}
