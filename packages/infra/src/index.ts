/**
 * index.ts — the public surface of @bmail/infra.
 *
 * Everything a consumer (apps/bmailctl, the future bmaild-admin, the MCP
 * server) is meant to use is re-exported here; the module files themselves
 * are implementation layout, not API.
 */

// Configuration.
export { loadConfig, feedbackHostForRegion } from './config.js';
export type { InfraConfig } from './config.js';

// Logging seam.
export { silentLogger } from './logger.js';
export type { InfraLogger } from './logger.js';

// Validation.
export { requireEmail, requireDomain, EMAIL_PATTERN, DOMAIN_PATTERN } from './validate.js';

// Mailboxes and display names (Maddy).
export {
  listMailboxes,
  createMailbox,
  rotateMailboxPassword,
  deleteMailbox,
  readDisplayNames,
  writeDisplayNames,
  setDisplayName,
  getDisplayName,
  removeDisplayName,
  addLocalDomain,
} from './maddy.js';
export type { CreatedMailbox } from './maddy.js';

// SES identities.
export {
  getIdentity,
  listDomainIdentities,
  verifyDomain,
  createDomainIdentity,
  createConfigurationSet,
} from './ses.js';
export type { DomainIdentitySummary, DomainVerification } from './ses.js';

// Route 53.
export { findHostedZoneId, buildUpsert, applyChanges } from './route53.js';
export type { RecordChange } from './route53.js';

// Client-facing DNS record sets.
export {
  buildLegacyFullRecords,
  buildLeanRecords,
  formatRecordsForClient,
} from './dns-records.js';
export type { DnsRecord, LeanRecordOptions } from './dns-records.js';

// Organization onboarding.
export { onboardOrganization, requireHostedZone } from './org.js';
export type { OnboardOptions, OnboardResult } from './org.js';
