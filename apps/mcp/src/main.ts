#!/usr/bin/env node
/**
 * main.ts — the "bmail" MCP server over stdio.
 *
 * One server, two tool families:
 *  - admin_* over @bmail/infra: Maddy mailboxes, SES organizations and DNS
 *    record sets, using the operator's local gcloud/aws sessions exactly
 *    like bmailctl does.
 *  - mail_* over @bmail/engine: the active user's mailbox by direct
 *    IMAP/SMTP — no local database, no sync.
 *
 * Register with Claude Code:
 *   claude mcp add bmail -- node /Users/berna/bmail/apps/mcp/dist/main.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildInfraConfig } from './infra-config.js';
import { MailSession } from './mail-session.js';
import { registerAdminTools } from './admin-tools.js';
import { registerMailTools } from './mail-tools.js';

// On stdio, stdout belongs to the JSON-RPC protocol. The engine logs its
// connection lifecycle with console.log, so route ALL console output to
// stderr before anything else runs — one stray line would corrupt the stream.
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
