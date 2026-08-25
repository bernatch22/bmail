#!/usr/bin/env node
/**
 * main.ts — the "bmail" MCP server over stdio.
 *
 * One server, two tool families:
 *  - admin_* over @bmail/admin: Maddy mailboxes, SES organizations and DNS
 *    record sets, using the operator's local gcloud/aws sessions exactly
 *    like bmailctl does.
 *  - mail_* over @bmail/core: the active user's mailbox by direct
 *    IMAP/SMTP — no local database, no sync.
 *
 * Install into the assistants on this machine:
 *   bmail-mcp install          (see cli.ts — ported from pinecall's installer)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { runCli } from './cli.js';
import { buildInfraConfig } from './infra-config.js';
import { MailSession } from './mail-session.js';
import { registerAdminTools } from './admin-tools.js';
import { registerMailTools } from './mail-tools.js';

// The argument side first: `install` and friends print to stdout and exit.
// Only a bare launch (or `serve`) falls through to the stdio server.
if (runCli(process.argv)) {
  process.exit(0);
}

// On stdio, stdout belongs to the JSON-RPC protocol. The engine logs its
// connection lifecycle with console.log, so route ALL console output to
// stderr before the server starts — one stray line would corrupt the stream.
console.log = console.error;
console.info = console.error;
console.warn = console.error;

async function main(): Promise<void> {
  const server = new McpServer({ name: 'bmail', version: '0.1.0' });

  registerAdminTools(server, buildInfraConfig());
  registerMailTools(server, new MailSession());

  await server.connect(new StdioServerTransport());
  console.error('bmail MCP server ready (stdio)');
}

main().catch((error: unknown) => {
  console.error('bmail MCP server failed to start:', error);
  process.exit(1);
});
