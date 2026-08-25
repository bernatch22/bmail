/**
 * admin-tools.ts — platform administration over @bmail/infra.
 *
 * These tools run the same operations bmailctl runs, using the operator's
 * local gcloud and aws sessions: Maddy mailboxes over gcloud ssh, SES
 * identities, Route 53 and the client-facing DNS record sets.
 *
 * Destructive operations (account_delete, org_add) demand an explicit
 * `confirm: true` argument and refuse without it — the model must surface
 * the question to the human instead of just proceeding.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  type InfraConfig,
  listMailboxes,
  createMailbox,
  rotateMailboxPassword,
  deleteMailbox,
  listDomainIdentities,
  verifyDomain,
  onboardOrganization,
  buildLegacyFullRecords,
  buildLeanRecords,
  formatRecordsForClient,
} from '@bmail/infra';

import { jsonResult, errorResult, runTool } from './tool-results.js';

export function registerAdminTools(server: McpServer, config: InfraConfig): void {
  // ─── Accounts (Maddy mailboxes) ──────────────────────

  server.registerTool(
    'account_create',
    {
      title: 'Create mailbox',
      description:
        'Create a Maddy mailbox with a random password (generated on the box). ' +
        'Returns the password ONCE — it is never stored anywhere.',
      inputSchema: {
        email: z.string().describe('Full address, e.g. hello@example.com'),
        name: z.string().optional().describe('Display name for the From header'),
      },
    },
    async ({ email, name }) =>
      runTool(async () => {
        const created = await createMailbox(config, email, { displayName: name });
        return jsonResult(created);
      }),
  );

  server.registerTool(
    'account_list',
    {
      title: 'List mailboxes',
      description: 'List every mailbox known to Maddy, optionally filtered by domain.',
      inputSchema: {
        domain: z.string().optional().describe('Only addresses on this domain'),
      },
    },
    async ({ domain }) =>
      runTool(async () => {
        let mailboxes = await listMailboxes(config);
        if (domain) {
          const suffix = `@${domain.toLowerCase()}`;
          mailboxes = mailboxes.filter((address) => address.toLowerCase().endsWith(suffix));
        }
        return jsonResult({ count: mailboxes.length, mailboxes });
      }),
  );

  server.registerTool(
    'account_passwd',
    {
      title: 'Rotate mailbox password',
      description:
        'Rotate the password of an existing mailbox to a new random one. ' +
        'Returns the new password ONCE — it is never stored anywhere.',
      inputSchema: {
        email: z.string().describe('Full address of the existing mailbox'),
      },
    },
    async ({ email }) =>
      runTool(async () => {
        const rotated = await rotateMailboxPassword(config, email);
        return jsonResult(rotated);
      }),
  );

  server.registerTool(
    'account_delete',
    {
      title: 'Delete mailbox',
      description:
        'DESTRUCTIVE: delete a mailbox and ALL of its mail, irreversibly. ' +
        'Refuses unless confirm is true — ask the human first.',
      inputSchema: {
        email: z.string().describe('Full address of the mailbox to delete'),
        confirm: z
          .boolean()
          .optional()
          .describe('Must be true; only after the human explicitly confirmed'),
      },
    },
    async ({ email, confirm }) =>
      runTool(async () => {
        if (confirm !== true) {
          return errorResult(
            `Refusing to delete ${email}: this destroys the mailbox and all its mail. ` +
              'Ask the human for confirmation, then retry with confirm: true.',
          );
        }
        await deleteMailbox(config, email);
        return jsonResult({ status: 'deleted', email });
      }),
  );

  // ─── Organizations (domains) ─────────────────────────

  server.registerTool(
    'org_list',
    {
      title: 'List organizations',
      description:
        'List every SES domain identity with its sending, DKIM and MAIL FROM standing.',
      inputSchema: {},
    },
    async () =>
      runTool(async () => {
        const organizations = await listDomainIdentities(config);
        return jsonResult({ count: organizations.length, organizations });
      }),
  );

  server.registerTool(
    'org_verify',
    {
      title: 'Verify organization domain',
      description:
        "Re-check a domain's SES verification: sending status, DKIM status and " +
        'tokens, MAIL FROM attributes.',
      inputSchema: {
        domain: z.string().describe('The organization domain, e.g. example.com'),
      },
    },
    async ({ domain }) =>
      runTool(async () => {
        const verification = await verifyDomain(config, domain);
        return jsonResult(verification);
      }),
  );

  server.registerTool(
    'org_add',
    {
      title: 'Onboard organization',
      description:
        'Onboard a whole domain: SES identity + Easy-DKIM + MAIL FROM, the full ' +
        'Route 53 record set, and Maddy local_domains + reload. Requires a Route 53 ' +
        'hosted zone for the domain. Refuses unless confirm is true — ask the human first.',
      inputSchema: {
        domain: z.string().describe('The domain to onboard, e.g. example.com'),
        webmail: z
          .boolean()
          .optional()
          .describe('Also point mail.<domain> at our box (nginx/cert stay manual)'),
        confirm: z
          .boolean()
          .optional()
          .describe('Must be true; only after the human explicitly confirmed'),
      },
    },
    async ({ domain, webmail, confirm }) =>
      runTool(async () => {
        if (confirm !== true) {
          return errorResult(
            `Refusing to onboard ${domain}: this writes SES identities, Route 53 records ` +
              'and Maddy config. Ask the human for confirmation, then retry with confirm: true.',
          );
        }
        const result = await onboardOrganization(config, domain, { webmail });
        return jsonResult(result);
      }),
  );

  server.registerTool(
    'dns_records',
    {
      title: 'DNS records for a domain',
      description:
        'Generate the DNS record set an organization must publish. lean: true → the ' +
        '3-4 indirected records for a client who keeps their own DNS (no AWS calls); ' +
        'default → the full 7-record set, fetching the Easy-DKIM tokens from SES ' +
        '(the domain must already have an SES identity).',
      inputSchema: {
        domain: z.string().describe('The organization domain, e.g. example.com'),
        lean: z.boolean().optional().describe('Return the lean client-facing set'),
      },
    },
    async ({ domain, lean }) =>
      runTool(async () => {
        let records;

        if (lean) {
          records = buildLeanRecords(config, domain);
        } else {
          // The full set embeds the three Easy-DKIM CNAMEs, so it needs the
          // tokens SES generated for this domain's identity.
          const verification = await verifyDomain(config, domain);
          records = buildLegacyFullRecords(config, domain, verification.dkimTokens);
        }

        return jsonResult({
          domain,
          mode: lean ? 'lean' : 'legacy-full',
          records,
          pasteBlock: formatRecordsForClient(domain, records),
        });
      }),
  );
}
