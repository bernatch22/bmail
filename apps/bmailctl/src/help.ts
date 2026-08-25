/**
 * help.ts — the usage text.
 *
 * Kept in its own module so the entry point stays a readable dispatcher.
 */

import { color } from './output.js';

export const CLI_VERSION = 'bmailctl 0.2.0';

export const HELP_TEXT = `${color.bold('bmailctl')} — manage the self-hosted email stack (accounts + organizations)

${color.bold('ACCOUNTS')}  (any verified domain — instant, no SES/DNS work)
  bmailctl account create <email> [--name "Full Name"]
  bmailctl account list [--domain <domain>]
  bmailctl account passwd <email> [--password <pwd>] [-y]
  bmailctl account name  <email> ["Full Name" | --clear]
  bmailctl account delete <email> [-y]

${color.bold('ORGANIZATIONS')}  (domains — one-time onboarding)
  bmailctl org add     <domain> [--webmail] [-y]
  bmailctl org list
  bmailctl org verify  <domain>
  bmailctl org records <domain> [--lean]   DNS records for the client's zone

${color.bold('GLOBAL')}   --json (machine output)   -y/--yes (skip confirm)

${color.dim('Config: BMAIL_* env vars, overridden by ~/.bmailctl.json (flat JSON of config fields).')}
${color.dim('Drives Maddy over gcloud ssh + AWS SES/Route53 over the aws CLI (local creds).')}`;
