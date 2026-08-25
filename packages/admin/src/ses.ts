/**
 * ses.ts — AWS SES v2 domain identities: create, list, verify, MAIL FROM.
 *
 * SES verifies at the DOMAIN level, so once a domain identity is verified,
 * new mailboxes on it need zero SES/DNS work. All calls go through the aws
 * CLI wrapper (aws.ts) in the configured region.
 */

import type { InfraConfig } from './config.js';
import type { InfraLogger } from './logger.js';
import { silentLogger } from './logger.js';
import { runAws, awsErrorText } from './aws.js';
import { requireDomain } from './validate.js';

// ── reading identities ────────────────────────────────────────────────────────

// Fetch one domain identity in full, or null when SES does not know it.
export async function getIdentity(config: InfraConfig, domain: string): Promise<any | null> {
  try {
    return await runAws([
      'sesv2', 'get-email-identity',
      '--region', config.sesRegion,
      '--email-identity', domain,
    ]);
  } catch {
    return null;
  }
}

export interface DomainIdentitySummary {
  domain: string;
  sending: 'verified' | 'pending';
  dkim: string;
  mailFrom: string;
  mailFromStatus: string;
}

// List every DOMAIN identity with its sending/DKIM/MAIL FROM standing.
export async function listDomainIdentities(config: InfraConfig): Promise<DomainIdentitySummary[]> {
  const listing = await runAws(['sesv2', 'list-email-identities', '--region', config.sesRegion]);

  const domainIdentities = (listing?.EmailIdentities || []).filter(
    (identity: any) => identity.IdentityType === 'DOMAIN',
  );

  const summaries: DomainIdentitySummary[] = [];

  for (const identity of domainIdentities) {
    const full = await getIdentity(config, identity.IdentityName);

    summaries.push({
      domain: identity.IdentityName,
      sending: full?.VerifiedForSendingStatus ? 'verified' : 'pending',
      dkim: full?.DkimAttributes?.Status || '?',
      mailFrom: full?.MailFromAttributes?.MailFromDomain || '-',
      mailFromStatus: full?.MailFromAttributes?.MailFromDomainStatus || '-',
    });
  }

  return summaries;
}

export interface DomainVerification {
  domain: string;
  sending: 'verified' | 'pending';
  dkim: string | undefined;
  dkimTokens: string[];
  mailFrom: any | null;
}

// Re-check one domain's verification standing. Throws when the identity
// does not exist (the caller should onboard the org first).
export async function verifyDomain(config: InfraConfig, domain: string): Promise<DomainVerification> {
  const normalizedDomain = requireDomain(domain);
  const full = await getIdentity(config, normalizedDomain);

  if (!full) {
    throw new Error(`no SES identity for ${normalizedDomain} — onboard the org first (org add)`);
  }

  return {
    domain: normalizedDomain,
    sending: full.VerifiedForSendingStatus ? 'verified' : 'pending',
    dkim: full.DkimAttributes?.Status,
    dkimTokens: full.DkimAttributes?.Tokens || [],
    mailFrom: full.MailFromAttributes || null,
  };
}

// ── creating identities ───────────────────────────────────────────────────────

// Create (or re-affirm) the domain identity with Easy-DKIM, and point its
// custom MAIL FROM at bounce.<domain>. Idempotent: AlreadyExists is fine.
// Returns the Easy-DKIM tokens, which the caller turns into CNAME records.
export async function createDomainIdentity(
  config: InfraConfig,
  domain: string,
  logger: InfraLogger = silentLogger,
): Promise<{ dkimTokens: string[] }> {
  const normalizedDomain = requireDomain(domain);

  logger.step('SES: create/ensure domain identity + Easy-DKIM');

  await runAws([
    'sesv2', 'create-email-identity',
    '--region', config.sesRegion,
    '--email-identity', normalizedDomain,
  ]).catch((error) => {
    if (!/AlreadyExists/i.test(awsErrorText(error))) {
      throw error;
    }
  });

  logger.step(`SES: set custom MAIL FROM → bounce.${normalizedDomain}`);

  await runAws([
    'sesv2', 'put-email-identity-mail-from-attributes',
    '--region', config.sesRegion,
    '--email-identity', normalizedDomain,
    '--mail-from-domain', `bounce.${normalizedDomain}`,
    '--behavior-on-mx-failure', 'USE_DEFAULT_VALUE',
  ]);

  // The tokens can lag a few seconds behind identity creation; surfacing
  // that as an explicit error beats returning a half-usable record set.
  const identity = await getIdentity(config, normalizedDomain);
  const dkimTokens: string[] = identity?.DkimAttributes?.Tokens || [];

  if (dkimTokens.length < 3) {
    throw new Error('SES did not return DKIM tokens yet — wait a few seconds and re-run.');
  }

  return { dkimTokens };
}

// ── deliverability (level 1) ──────────────────────────────────────────────────

// TODO(deliverability): create a per-domain SES configuration set and wire
// SNS event destinations (bounces, complaints, deliveries) into it, so we
// can watch reputation per organization instead of per account. Stub only:
// nothing calls this yet.
export async function createConfigurationSet(
  config: InfraConfig,
  domain: string,
): Promise<void> {
  void config;
  void domain;

  throw new Error('createConfigurationSet is not implemented yet (see TODO(deliverability))');
}
