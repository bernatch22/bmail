/**
 * org.ts — one-time onboarding of an organization (a whole domain).
 *
 * Composes the other modules into the org-level operation the CLI (and,
 * later, the admin API and the MCP server) exposes:
 *
 *   SES identity + Easy-DKIM + MAIL FROM
 *     → Route 53 record set (legacy full mode; we host the zone)
 *       → Maddy local_domains + reload
 *
 * Idempotent end to end, and it refuses up front when the hosted zone does
 * not exist — half-onboarding a domain is worse than not starting.
 * No prompts here: the CLI asks its questions before calling in.
 */

import type { InfraConfig } from './config.js';
import type { InfraLogger } from './logger.js';
import { silentLogger } from './logger.js';
import { requireDomain } from './validate.js';
import { createDomainIdentity } from './ses.js';
import { findHostedZoneId, buildUpsert, applyChanges } from './route53.js';
import { addLocalDomain } from './maddy.js';
import { buildLegacyFullRecords } from './dns-records.js';

// ── pre-flight ────────────────────────────────────────────────────────────────

// Resolve the hosted zone or explain exactly what is missing. Exposed
// separately so the CLI can check BEFORE asking the human to confirm.
export async function requireHostedZone(domain: string): Promise<string> {
  const zoneId = await findHostedZoneId(domain);

  if (!zoneId) {
    throw new Error(
      `no Route 53 hosted zone for ${domain}. ` +
        `Register/create the zone first (aws route53 create-hosted-zone) ` +
        `and point the registrar NS at it, then re-run.`,
    );
  }

  return zoneId;
}

// ── the operation ─────────────────────────────────────────────────────────────

export interface OnboardOptions {
  // Also point mail.<domain> at our box for the hosted webmail.
  // nginx vhost + certificate are still manual in v0.
  webmail?: boolean;
}

export interface OnboardResult {
  domain: string;
  zoneId: string;
  dkimTokens: string[];
  webmail: boolean;
}

// Onboard a domain end to end. Assumes the caller already confirmed.
export async function onboardOrganization(
  config: InfraConfig,
  domain: string,
  options: OnboardOptions = {},
  logger: InfraLogger = silentLogger,
): Promise<OnboardResult> {
  const normalizedDomain = requireDomain(domain);
  const zoneId = await requireHostedZone(normalizedDomain);

  // 1. SES identity, Easy-DKIM, custom MAIL FROM.
  const { dkimTokens } = await createDomainIdentity(config, normalizedDomain, logger);

  // 2. Route 53: the full record set (we host this zone, so we write all
  //    of it ourselves instead of handing the client the lean set).
  logger.step('Route 53: MX, SPF, DMARC, 3× DKIM CNAME, MAIL-FROM MX+SPF');

  const records = buildLegacyFullRecords(config, normalizedDomain, dkimTokens);
  const changes = records.map((record) =>
    buildUpsert(`${record.name}.`, record.type, record.ttl, [record.value]),
  );

  await applyChanges(config, zoneId, changes, 'bmail org onboarding');

  // 3. Maddy accepts the new domain.
  await addLocalDomain(config, normalizedDomain, logger);

  logger.ok(`domain ${normalizedDomain} onboarded — SES + DNS + Maddy ready`);
  logger.detail('DKIM verification propagates in minutes; re-check with org verify');

  // 4. Optional webmail A record.
  if (options.webmail) {
    logger.step(`webmail: A record mail.${normalizedDomain} → ${config.mailIp}`);

    await applyChanges(
      config,
      zoneId,
      [buildUpsert(`mail.${normalizedDomain}.`, 'A', 3600, [config.mailIp])],
      'bmail webmail A record',
    );

    logger.warn(
      `nginx vhost + cert for mail.${normalizedDomain} not automated in v0 — ` +
        `run on the box: sudo certbot --nginx -d mail.${normalizedDomain}`,
    );
  }

  return {
    domain: normalizedDomain,
    zoneId,
    dkimTokens,
    webmail: !!options.webmail,
  };
}
