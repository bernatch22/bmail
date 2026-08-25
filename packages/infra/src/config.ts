/**
 * config.ts — the infra configuration object and how it is built.
 *
 * One plain object (InfraConfig) describes the whole stack: which GCP box
 * runs Maddy, which SES region sends, which host the clients connect to.
 * Every field can be overridden by a BMAIL_* environment variable, and the
 * caller (the CLI reading ~/.bmailctl.json, a server reading its own file)
 * can layer explicit overrides on top of that.
 *
 * BUG FIXED here versus bmailctl v0: the SES feedback (MAIL FROM) MX host
 * was 'feedback-smtp.us-east-1.amazonaws.com', which does not resolve. The
 * real service lives under amazonSES.com, and it is per-region — so it is
 * now derived from sesRegion instead of being a hardcoded literal.
 */

// ── the shape ─────────────────────────────────────────────────────────────────

export interface InfraConfig {
  // GCP: where the Maddy box lives.
  zone: string;
  box: string;

  // Pin the project: relying on the gcloud default breaks (hangs) whenever a
  // re-login switches it to a project where the Compute API is disabled.
  project: string;

  // What mail clients connect to (IMAP 993 / SMTP 465).
  mailHost: string;
  mailIp: string;

  // AWS SES region for outbound mail and identities.
  sesRegion: string;

  // SES feedback SMTP host for custom MAIL FROM MX records.
  // Derived from sesRegion; MUST be an amazonses.com host (see file header).
  feedbackHost: string;

  // Where our own hosted DNS helpers live, for the lean client record set:
  // organizations point a couple of CNAMEs/includes at these instead of
  // copying long values. See dns-records.ts.
  spfIncludeHost: string;
  dkimHostRoot: string;
  dmarcHostRoot: string;

  // Files on the Maddy box.
  displayNamesPath: string;
  maddyConf: string;
}

// ── construction ──────────────────────────────────────────────────────────────

// The SES feedback host follows the region. amazonses.com is correct;
// the old .amazonaws.com spelling was a bug (NXDOMAIN).
export function feedbackHostForRegion(sesRegion: string): string {
  return `feedback-smtp.${sesRegion}.amazonses.com`;
}

// Build the effective config. Precedence, lowest to highest:
// built-in defaults → BMAIL_* environment variables → explicit overrides
// (the CLI feeds ~/.bmailctl.json through this last argument).
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<InfraConfig> = {},
): InfraConfig {
  const sesRegion =
    overrides.sesRegion || env.BMAIL_SES_REGION || 'us-east-1';

  const defaults: InfraConfig = {
    zone: env.BMAIL_ZONE || 'us-central1-a',
    box: env.BMAIL_BOX || 'bc-mail',
    project: env.BMAIL_PROJECT || 'hiding-place-447317-c6',
    mailHost: env.BMAIL_MAIL_HOST || 'mail.bernardocastro.dev',
    mailIp: env.BMAIL_MAIL_IP || '35.223.254.55',

    sesRegion,
    feedbackHost: env.BMAIL_FEEDBACK_HOST || feedbackHostForRegion(sesRegion),

    spfIncludeHost: env.BMAIL_SPF_INCLUDE || 'spf.bmail.bernardocastro.dev',
    dkimHostRoot: env.BMAIL_DKIM_HOST_ROOT || 'dkim.bmail.bernardocastro.dev',
    dmarcHostRoot: env.BMAIL_DMARC_HOST_ROOT || 'dmarc.bmail.bernardocastro.dev',

    displayNamesPath: env.BMAIL_DISPLAY_NAMES_PATH || '/etc/bmail/display-names.json',
    maddyConf: env.BMAIL_MADDY_CONF || '/etc/maddy/maddy.conf',
  };

  return { ...defaults, ...overrides };
}
