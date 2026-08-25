/**
 * mail-tools.ts — the active user's mailbox over direct IMAP/SMTP.
 *
 * These tools speak to the mail server itself through the engine
 * (ImapService / SmtpSender) — no local database, no sync. Each call opens
 * a fresh IMAP connection and closes it (see mail-session.ts for why).
 *
 * Attachment downloads go to DISK and the tool returns the path: raw bytes
 * in a tool result would blow up the model's context for nothing.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapMessageEnvelope } from '@bmail/engine';

import { jsonResult, errorResult, runTool } from './tool-results.js';
import type { MailSession } from './mail-session.js';

// ─── Result shaping ────────────────────────────────────

/** One envelope, trimmed to what a listing needs (dates as ISO strings). */
function envelopeSummary(message: ImapMessageEnvelope) {
  return {
    uid: message.uid,
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date ? message.date.toISOString() : null,
    seen: message.seen,
    hasAttachments: message.hasAttachments,
  };
}

/** Keep a saved attachment's filename safe and free of path tricks. */
function safeFilename(filename: string): string {
  const flattened = basename(filename).replace(/[\\/:\0]/g, '_').trim();
  return flattened || 'attachment';
}

/** First free path for a filename in a directory (name, name-2, name-3…). */
function nonClobberingPath(directory: string, filename: string): string {
  const extension = extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);

  let candidate = join(directory, filename);
  let counter = 2;

  while (existsSync(candidate)) {
    candidate = join(directory, `${stem}-${counter}${extension}`);
    counter++;
  }

  return candidate;
}

// ─── Registration ──────────────────────────────────────

export function registerMailTools(server: McpServer, session: MailSession): void {
  server.registerTool(
    'mail_login',
    {
      title: 'Log in to a mailbox',
      description:
        'Set the mailbox the mail tools operate on, overriding the ' +
        'BMAIL_MCP_EMAIL/BMAIL_MCP_PASSWORD environment for this server process. ' +
        'Credentials are kept in memory only.',
      inputSchema: {
        email: z.string().describe('Full address, e.g. me@bernardocastro.dev'),
        password: z.string().describe('The IMAP password for that address'),
      },
    },
    async ({ email, password }) =>
      runTool(async () => {
        session.login(email, password);

        // Prove the credentials work now, not on the next tool call.
        await session.withImap(async () => {});

        return jsonResult({ status: 'logged-in', email });
      }),
  );

  server.registerTool(
    'mail_list',
    {
      title: 'List messages',
      description:
        'List message envelopes in a folder, newest first, straight from IMAP. ' +
        'Folders are IMAP paths: INBOX, Sent, Drafts, Trash, Archive, Junk.',
      inputSchema: {
        folder: z.string().optional().describe('IMAP folder (default INBOX)'),
        limit: z.number().int().min(1).max(100).optional().describe('Max envelopes (default 20)'),
      },
    },
    async ({ folder, limit }) =>
      runTool(async () => {
        const targetFolder = folder || 'INBOX';

        const { messages, total } = await session.withImap((imap) =>
          imap.listMessages(targetFolder, limit ?? 20, 1),
        );

        return jsonResult({
          folder: targetFolder,
          total,
          messages: messages.map(envelopeSummary),
        });
      }),
  );

  server.registerTool(
    'mail_read',
    {
      title: 'Read a message',
      description:
        'Fetch one full message by UID: parsed body plus the attachment list ' +
        '(each with the partId to pass to mail_attachment). Marks it read.',
      inputSchema: {
        folder: z.string().describe('IMAP folder the message lives in'),
        uid: z.number().int().describe('Message UID from mail_list'),
      },
    },
    async ({ folder, uid }) =>
      runTool(async () => {
        const message = await session.withImap((imap) => imap.getMessage(folder, uid));

        if (!message) {
          return errorResult(`No message with uid ${uid} in ${folder}.`);
        }

        return jsonResult({
          uid: message.uid,
          subject: message.subject,
          from: message.from,
          to: message.to,
          cc: message.cc,
          date: message.date ? message.date.toISOString() : null,
          messageId: message.messageId ?? null,
          inReplyTo: message.inReplyTo ?? null,
          // Prefer the text body; fall back to raw HTML only when there is no
          // text alternative, so results stay readable and small.
          body: message.textBody || message.htmlBody,
          bodyKind: message.textBody ? 'text' : message.htmlBody ? 'html' : 'empty',
          attachments: message.attachments,
        });
      }),
  );

  server.registerTool(
    'mail_attachment',
    {
      title: 'Download an attachment',
      description:
        'Save one attachment to disk and return the saved path (never the bytes). ' +
        'partId comes from the attachment list in mail_read.',
      inputSchema: {
        folder: z.string().describe('IMAP folder the message lives in'),
        uid: z.number().int().describe('Message UID from mail_list'),
        partId: z.string().describe('Attachment partId from mail_read'),
        outDir: z.string().optional().describe('Directory to save into (default ~/Downloads)'),
      },
    },
    async ({ folder, uid, partId, outDir }) =>
      runTool(async () => {
        const attachment = await session.withImap((imap) =>
          imap.getAttachment(folder, uid, partId),
        );

        if (!attachment) {
          return errorResult(`No attachment ${partId} on message ${uid} in ${folder}.`);
        }

        const directory = resolve(outDir || join(homedir(), 'Downloads'));
        mkdirSync(directory, { recursive: true });

        const savedPath = nonClobberingPath(directory, safeFilename(attachment.filename));
        writeFileSync(savedPath, attachment.content);

        return jsonResult({
          path: savedPath,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.content.length,
        });
      }),
  );

  server.registerTool(
    'mail_send',
    {
      title: 'Send a message',
      description:
        'Send mail as the active user through SMTP submission (a copy lands in ' +
        'Sent). attachments are LOCAL FILE PATHS, read and attached by the server. ' +
        'For a reply, pass the Message-ID being answered as inReplyTo.',
      inputSchema: {
        to: z.string().describe('Recipient(s), comma-separated'),
        subject: z.string().describe('Subject line'),
        body: z.string().describe('Plain-text body'),
        inReplyTo: z.string().optional().describe('Message-ID being answered (threads the reply)'),
        attachments: z
          .array(z.string())
          .optional()
          .describe('Local file paths to read and attach'),
      },
    },
    async ({ to, subject, body, inReplyTo, attachments }) =>
      runTool(async () => {
        const { email, password } = session.credentials();

        // Read the attachment files up front so a bad path fails the tool
        // call before anything is sent.
        const outgoingAttachments = (attachments ?? []).map((filePath) => {
          const absolutePath = resolve(filePath);
          if (!existsSync(absolutePath)) {
            throw new Error(`Attachment file not found: ${absolutePath}`);
          }
          return {
            filename: basename(absolutePath),
            content: readFileSync(absolutePath),
          };
        });

        // The IMAP connection is only for the best-effort Sent copy; the
        // send itself goes over SMTP with the same credentials.
        const result = await session.withImap((imap) =>
          session.smtpSender.send(
            {
              email,
              password,
              to,
              subject,
              text: body,
              inReplyTo,
              attachments: outgoingAttachments.length > 0 ? outgoingAttachments : undefined,
            },
            imap,
          ),
        );

        return jsonResult({
          status: 'sent',
          from: email,
          to,
          subject,
          messageId: result.messageId,
          attachmentCount: outgoingAttachments.length,
        });
      }),
  );
}
