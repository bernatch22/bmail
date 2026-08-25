/**
 * route-send.ts — POST /api/send: send mail AS the logged-in user.
 *
 * The nodemailer/Maddy/Sent-copy choreography lives in SmtpSender; this
 * handler only parses the body, decodes attachments and serializes.
 *
 * Attachments (step 11) travel as a base64 JSON array:
 *
 *   { "attachments": [ { "filename": "invoice.pdf",
 *                        "contentType": "application/pdf",
 *                        "contentBase64": "<base64>" } ] }
 *
 * Chosen over multipart for simplicity: one JSON body, no extra parser, and
 * the client SDK already speaks JSON. TODO: accept multipart/form-data too
 * for large files (base64 inflates payloads by ~33%).
 */

import { Router } from 'express';
import type { Response, Router as ExpressRouter } from 'express';

import type { SmtpSender, OutgoingAttachment } from '@bmail/engine';

import type { AuthedRequest } from './auth.js';

// ─── Wire shape of one attachment in the request body ──

interface AttachmentPayload {
  filename?: unknown;
  contentType?: unknown;
  contentBase64?: unknown;
}

/**
 * Validate and decode the attachments array. Throws with a client-worthy
 * message on the first malformed entry.
 */
function decodeAttachments(raw: unknown): OutgoingAttachment[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new Error('attachments must be an array of { filename, contentType, contentBase64 }');
  }

  return raw.map((entry: AttachmentPayload, index: number) => {
    if (typeof entry?.filename !== 'string' || !entry.filename) {
      throw new Error(`attachments[${index}].filename is required`);
    }
    if (typeof entry.contentBase64 !== 'string' || !entry.contentBase64) {
      throw new Error(`attachments[${index}].contentBase64 is required`);
    }

    return {
      filename: entry.filename,
      contentType: typeof entry.contentType === 'string' ? entry.contentType : undefined,
      content: entry.contentBase64,
      encoding: 'base64',
    };
  });
}

// ─── Route ─────────────────────────────────────────────

export function createSendRoute(sender: SmtpSender): ExpressRouter {
  const router = Router();

  router.post('/', async (req: AuthedRequest, res: Response) => {
    try {
      const { to, cc, subject, html, text, threadId, inReplyTo, attachments } = req.body ?? {};

      if (!to || !subject) {
        res.status(400).json({ error: 'Missing required fields: to, subject' });
        return;
      }

      let decodedAttachments: OutgoingAttachment[] | undefined;
      try {
        decodedAttachments = decodeAttachments(attachments);
      } catch (validationError: unknown) {
        const message =
          validationError instanceof Error ? validationError.message : 'Bad attachments';
        res.status(400).json({ error: message });
        return;
      }

      // Send via Maddy submission; the Sent copy is appended best-effort
      // through the user's own warm IMAP connection.
      const result = await sender.send(
        {
          email: req.email!,
          password: req.password!,
          to,
          cc: cc || undefined,
          subject,
          text: text || undefined,
          html: html || undefined,
          inReplyTo: inReplyTo || undefined,
          attachments: decodedAttachments,
        },
        req.trio!.imap,
      );

      // Echo an envelope-shaped message so the UI can show the sent mail
      // immediately without waiting for the next Sent-folder sync.
      res.json({
        status: 'sent',
        messageId: result.smtpMessageId,
        message: {
          uid: 0,
          seq: 0,
          subject,
          from: req.email!,
          to,
          cc: cc || '',
          date: new Date().toISOString(),
          seen: true,
          hasAttachments: Boolean(decodedAttachments && decodedAttachments.length > 0),
          preview: (text || '').slice(0, 100),
          textBody: text || '',
          htmlBody: html || '',
          threadId: threadId || '',
          messageId: result.messageId,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Send failed';
      console.error('  ✗ Send failed:', message);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
