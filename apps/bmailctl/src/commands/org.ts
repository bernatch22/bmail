/**
 * commands/org.ts — the `bmailctl org …` command group (domains).
 *
 * add/list/verify keep the v0 behavior; `org records` is new: it prints
 * the DNS record set a client organization must publish, in either the
 * legacy full mode (7 records, we host the zone) or the lean mode
 * (3-4 records for a client who keeps their own DNS).
 */

import {
  type InfraConfig,
  listDomainIdentities,
  verifyDomain,
  requireDomain,
  requireHostedZone,
  onboardOrganization,
  getIdentity,
  buildLegacyFullRecords,
  buildLeanRecords,
  formatRecordsForClient,
} from '@bmail/infra';

import type { CliFlags } from '../flags.js';
import { CliOutput, color, confirm } from '../output.js';

// ── add (onboarding) ──────────────────────────────────────────────────────────

export async function orgAdd(
  config: InfraConfig,
  output: CliOutput,
  domain: string | undefined,
  flags: CliFlags,
): Promise<void> {
  const normalizedDomain = requireDomain(domain);

  // Check the zone BEFORE asking the human, so a missing zone fails fast
  // instead of after a confirmation.
  const zoneId = await requireHostedZone(normalizedDomain);

  output.info(
    `\n  ${color.bold('org add ' + normalizedDomain)}  ${color.dim('(zone ' + zoneId + ')')}`,
  );
  output.info(
    color.dim(
      '  will: SES identity+DKIM+MAILFROM → Route 53 records → Maddy local_domains + reload' +
        (flags.webmail ? ' → webmail vhost+cert' : ''),
    ),
  );

  if (!(await confirm('\n  Proceed?', flags.yes))) {
    output.info('aborted.');
    return;
  }

  const result = await onboardOrganization(
    config,
    normalizedDomain,
    { webmail: flags.webmail },
    output.asInfraLogger(),
  );

  output.info('');
  output.info(
    `  next: ${color.bold(`bmailctl account create hello@${normalizedDomain} --name "…"`)}`,
  );
  output.info('');

  output.emit({
    status: 'onboarded',
    domain: result.domain,
    zoneId: result.zoneId,
    dkimTokens: result.dkimTokens,
    webmail: result.webmail,
  });
}

// ── list ──────────────────────────────────────────────────────────────────────

export async function orgList(config: InfraConfig, output: CliOutput): Promise<void> {
  const organizations = await listDomainIdentities(config);

  if (output.jsonMode) {
    output.emit({ orgs: organizations });
    return;
  }

  output.info(color.bold('\n  SES domain identities\n'));

  for (const organization of organizations) {
    const sendingLabel =
      organization.sending === 'verified'
        ? color.green(organization.sending)
        : color.yellow(organization.sending);

    const dkimLabel =
      organization.dkim === 'SUCCESS'
        ? color.green(organization.dkim)
        : color.yellow(organization.dkim);

    console.log(
      `  ${color.bold(organization.domain.padEnd(24))} ` +
        `sending:${sendingLabel}  dkim:${dkimLabel}  ` +
        `mailfrom:${organization.mailFrom} (${organization.mailFromStatus})`,
    );
  }

  output.info('');
}

// ── verify ────────────────────────────────────────────────────────────────────

export async function orgVerify(
  config: InfraConfig,
  output: CliOutput,
  domain: string | undefined,
): Promise<void> {
  const verification = await verifyDomain(config, requireDomain(domain));

  if (output.jsonMode) {
    output.emit(verification);
    return;
  }

  const sendingLabel =
    verification.sending === 'verified' ? color.green('verified') : color.yellow('pending');

  const dkimLabel =
    verification.dkim === 'SUCCESS'
      ? color.green(verification.dkim)
      : color.yellow(verification.dkim || '?');

  output.info(`\n  ${color.bold(verification.domain)}`);
  output.info(`    sending   ${sendingLabel}`);
  output.info(`    dkim      ${dkimLabel}`);
  output.info(
    `    mailfrom  ${verification.mailFrom?.MailFromDomain || '-'} ` +
      `(${verification.mailFrom?.MailFromDomainStatus || '-'})`,
  );
  output.info('');
}

// ── records (new) ─────────────────────────────────────────────────────────────

// Print the client-facing DNS record set for a domain. Default is the
// legacy full mode (needs the SES identity to exist, for the DKIM tokens);
// --lean prints the 3-4 record scheme and needs nothing from AWS.
export async function orgRecords(
  config: InfraConfig,
  output: CliOutput,
  domain: string | undefined,
  flags: CliFlags,
): Promise<void> {
  const normalizedDomain = requireDomain(domain);

  let mode: 'lean' | 'legacy-full';
  let records;

  if (flags.lean) {
    mode = 'lean';
    records = buildLeanRecords(config, normalizedDomain);
  } else {
    mode = 'legacy-full';

    const identity = await getIdentity(config, normalizedDomain);
    const dkimTokens: string[] = identity?.DkimAttributes?.Tokens || [];

    if (dkimTokens.length < 3) {
      throw new Error(
        `no SES DKIM tokens for ${normalizedDomain} — run \`org add ${normalizedDomain}\` first, ` +
          `or use --lean for the hosted-DKIM record set`,
      );
    }

    records = buildLegacyFullRecords(config, normalizedDomain, dkimTokens);
  }

  if (output.jsonMode) {
    output.emit({ domain: normalizedDomain, mode, records });
    return;
  }

  console.log('');
  console.log(formatRecordsForClient(normalizedDomain, records));
}
