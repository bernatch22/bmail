/**
 * smtp-sender.ts — Outbound mail through Maddy SMTP submission (:465).
 *
 * Extracted from bermail's route-send.ts, where the nodemailer transport was
 * built inline in the Express handler. Maddy relays outbound through Amazon
 * SES; the user's own IMAP password authenticates the submission, so mail
 * goes out under the user's identity.
 *
 * The Sent copy is best-effort and shares the SMTP copy's Message-ID: the
 * message you sent and the message in your Sent folder must be the SAME
 * message, or reply threading breaks.
 */

import { randomUUID } from 'node:crypto';

import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

import type { DisplayNameResolver, OrgRegistry } from './org-registry.js';
import type { ImapService } from './imap-service.js';

// ─── Input shapes ──────────────────────────────────────

/** One attachment to send, in nodemailer's own shape (step 11). */
export interface OutgoingAttachment {
  filename: string;
  /** Raw bytes, or a string (nodemailer also accepts base64 via `encoding`). */
  content: Buffer | string;
  contentType?: string;
  /** Set to 'base64' when `content` is a base64 string. */
  encoding?: string;
}

export interface SendMailRequest {
  /** Authenticated sender — explicit credentials, nothing ambient. */
  email: string;
  password: string;

  to: string;
  cc?: string;
  subject: string;
  text?: string;
  html?: string;

  /** Message-ID being answered; also becomes the References header. */
  inReplyTo?: string;

  attachments?: OutgoingAttachment[];
}

export interface SendMailResult {
  /** The Message-ID we generated (identical in SMTP and Sent copies). */
  messageId: string;
  /** Message-ID as reported back by the SMTP server. */
  smtpMessageId: string;
}

// ─── Sender ────────────────────────────────────────────

const SUBMISSION_PORT = 465;

export class SmtpSender {
  private readonly orgRegistry: OrgRegistry;
  private readonly displayNames: DisplayNameResolver;

  constructor(orgRegistry: OrgRegistry, displayNames: DisplayNameResolver) {
    this.orgRegistry = orgRegistry;
    this.displayNames = displayNames;
  }

  /**
   * Send one message. When `sentCopyImap` is provided, a copy is appended to
   * the user's Sent folder best-effort (a Sent-copy failure never fails the
   * send itself).
   */
  async send(request: SendMailRequest, sentCopyImap?: ImapService): Promise<SendMailResult> {
    const org = this.orgRegistry.getOrgForEmail(request.email);
    if (!org) {
      throw new Error(`Sender domain not allowed: ${request.email}`);
    }

    // Maddy submission shares the mail hostname with IMAP.
    const transport = nodemailer.createTransport({
      host: org.imap.host,
      port: SUBMISSION_PORT,
      secure: true,
      auth: { user: request.email, pass: request.password },
    });

    // Fixed Message-ID: the SMTP copy and the Sent copy must be the same
    // message, so we generate the id ourselves instead of letting each copy
    // invent its own.
    const messageId = `<${randomUUID()}@${request.email.split('@')[1]}>`;

    const mailOptions = {
      from: {
        name: this.displayNames.nameFor(request.email),
        address: request.email,
      },
      to: request.to,
      cc: request.cc || undefined,
      subject: request.subject,
      text: request.text || undefined,
      html: request.html || undefined,
      date: new Date(),
      messageId,
      inReplyTo: request.inReplyTo || undefined,
      references: request.inReplyTo || undefined,
      attachments: request.attachments && request.attachments.length > 0
        ? request.attachments
        : undefined,
    };

    const info = await transport.sendMail(mailOptions);

    // Best-effort Sent copy with the exact same raw message.
    if (sentCopyImap) {
      try {
        const rawMessage = await new MailComposer(mailOptions).compile().build();
        await sentCopyImap.appendToSent(rawMessage);
      } catch {
        // Ignore Sent-copy errors — the mail already went out.
      }
    }

    return {
      messageId,
      smtpMessageId: info.messageId,
    };
  }
}
