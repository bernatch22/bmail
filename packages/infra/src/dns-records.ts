/**
 * dns-records.ts — the DNS record set a client organization must publish.
 *
 * Two modes:
 *
 *  - 'legacy-full': the 7 records bmailctl v0 wrote directly into Route 53
 *    (MX, SPF TXT, DMARC TXT, 3× Easy-DKIM CNAME, bounce MX + bounce SPF),
 *    with the corrected feedback host (amazonses.com — see config.ts).
 *    Used when WE host the zone and can write everything ourselves.
 *
 *  - 'lean': the 3-4 records we hand to a client who keeps their own DNS.
 *    Indirection keeps their zone stable while we evolve ours:
 *      MX               → our mail host
 *      SPF TXT          → "v=spf1 include:spf.bmail… ~all" (one include)
 *      bmail._domainkey → single BYODKIM CNAME into a zone we host
 *      _dmarc (optional)→ CNAME into a DMARC policy we host
 *
 * IMPORTANT: the DMARC template must NOT use aspf=s. SES's default MAIL
 * FROM domain is not a subdomain of the client's domain, so strict SPF
 * alignment fails and aspf=s turns every SES send into a DMARC failure.
 * Relaxed alignment (the default) is correct here.
 */

import type { InfraConfig } from './config.js';

// ── the record shape ──────────────────────────────────────────────────────────

export interface DnsRecord {
  // Fully-qualified record name, no trailing dot (client-facing).
  name: string;
  type: 'MX' | 'TXT' | 'CNAME';
  ttl: number;
  value: string;

  // One line of human context for the paste-this block.
  purpose: string;
}

const DEFAULT_TTL = 3600;

// ── legacy full set (we host the zone) ────────────────────────────────────────

// The complete Route 53 record set for a domain we manage end to end.
// dkimTokens are the three Easy-DKIM tokens returned by SES.
export function buildLegacyFullRecords(
  config: InfraConfig,
  domain: string,
  dkimTokens: string[],
): DnsRecord[] {
  const records: DnsRecord[] = [];

  records.push({
    name: domain,
    type: 'MX',
    ttl: DEFAULT_TTL,
    value: `10 ${config.mailHost}.`,
    purpose: 'inbound mail → our Maddy server',
  });

  records.push({
    name: domain,
    type: 'TXT',
    ttl: DEFAULT_TTL,
    value: `"v=spf1 include:amazonses.com ~all"`,
    purpose: 'SPF: outbound goes through SES',
  });

  // No aspf=s — see the file header for why strict SPF alignment breaks
  // under SES's default MAIL FROM.
  records.push({
    name: `_dmarc.${domain}`,
    type: 'TXT',
    ttl: DEFAULT_TTL,
    value: `"v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; adkim=s"`,
    purpose: 'DMARC policy (relaxed SPF alignment on purpose)',
  });

  for (const token of dkimTokens) {
    records.push({
      name: `${token}._domainkey.${domain}`,
      type: 'CNAME',
      ttl: DEFAULT_TTL,
      value: `${token}.dkim.amazonses.com`,
      purpose: 'SES Easy-DKIM',
    });
  }

  records.push({
    name: `bounce.${domain}`,
    type: 'MX',
    ttl: DEFAULT_TTL,
    // feedbackHost derives from the SES region and is an amazonses.com
    // host — the old amazonaws.com spelling did not resolve.
    value: `10 ${config.feedbackHost}`,
    purpose: 'custom MAIL FROM: bounce handling via SES',
  });

  records.push({
    name: `bounce.${domain}`,
    type: 'TXT',
    ttl: DEFAULT_TTL,
    value: `"v=spf1 include:amazonses.com ~all"`,
    purpose: 'SPF for the MAIL FROM subdomain',
  });

  return records;
}

// ── lean set (client keeps their DNS) ─────────────────────────────────────────

export interface LeanRecordOptions {
  // Include the optional DMARC CNAME (default true — clients should have
  // a policy, but some already manage their own DMARC).
  includeDmarc?: boolean;
}

// The 3-4 records a client pastes into their own DNS. Everything volatile
// (DKIM keys, DMARC policy text) lives behind names WE host, so the client
// never has to touch their zone again.
export function buildLeanRecords(
  config: InfraConfig,
  domain: string,
  options: LeanRecordOptions = {},
): DnsRecord[] {
  const includeDmarc = options.includeDmarc !== false;
  const records: DnsRecord[] = [];

  records.push({
    name: domain,
    type: 'MX',
    ttl: DEFAULT_TTL,
    value: `10 ${config.mailHost}.`,
    purpose: 'inbound mail → our mail server',
  });

  records.push({
    name: domain,
    type: 'TXT',
    ttl: DEFAULT_TTL,
    value: `"v=spf1 include:${config.spfIncludeHost} ~all"`,
    purpose: 'SPF: one include we maintain for the client',
  });

  // Single BYODKIM selector: the client publishes ONE CNAME and we rotate
  // the actual key material inside our own zone.
  records.push({
    name: `bmail._domainkey.${domain}`,
    type: 'CNAME',
    ttl: DEFAULT_TTL,
    value: `${domain}.${config.dkimHostRoot}`,
    purpose: 'DKIM: single CNAME into a key we host and rotate',
  });

  if (includeDmarc) {
    // The policy TXT behind this CNAME lives in our zone, and it must NOT
    // carry aspf=s (see the file header).
    records.push({
      name: `_dmarc.${domain}`,
      type: 'CNAME',
      ttl: DEFAULT_TTL,
      value: `${domain}.${config.dmarcHostRoot}`,
      purpose: 'DMARC: policy hosted by us',
    });
  }

  return records;
}

// ── the paste-this block ──────────────────────────────────────────────────────

// Render a record set as a plain-text block a client can paste next to
// their DNS console. Columns padded so it reads as a table.
export function formatRecordsForClient(domain: string, records: DnsRecord[]): string {
  const nameWidth = Math.max(...records.map((record) => record.name.length), 4);
  const typeWidth = 5;

  const lines: string[] = [];

  lines.push(`DNS records for ${domain} — paste these into your DNS provider:`);
  lines.push('');

  for (const record of records) {
    lines.push(
      `  ${record.name.padEnd(nameWidth)}  ${record.type.padEnd(typeWidth)}  TTL ${record.ttl}  ${record.value}`,
    );
    lines.push(`  ${''.padEnd(nameWidth)}  ${''.padEnd(typeWidth)}  ^ ${record.purpose}`);
    lines.push('');
  }

  return lines.join('\n');
}
