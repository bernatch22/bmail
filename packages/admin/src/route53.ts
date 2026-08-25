/**
 * route53.ts — Route 53 lookups and record-change plumbing.
 *
 * DNS for domains we host is ALWAYS Route 53 (never GCP, never the
 * registrar). This module finds a domain's hosted zone and applies UPSERT
 * change batches built from simple record descriptions.
 */

import type { InfraConfig } from './config.js';
import { runAws } from './aws.js';

// ── zone lookup ───────────────────────────────────────────────────────────────

// Find the hosted zone id for a domain, or null when we do not host it.
// The list call matches by name prefix, so we filter for the exact name.
export async function findHostedZoneId(domain: string): Promise<string | null> {
  const response = await runAws(['route53', 'list-hosted-zones-by-name', '--dns-name', domain]);

  const exactMatch = (response?.HostedZones || []).find(
    (zone: any) => zone.Name.replace(/\.$/, '') === domain,
  );

  if (!exactMatch) {
    return null;
  }

  return exactMatch.Id.replace('/hostedzone/', '');
}

// ── change batches ────────────────────────────────────────────────────────────

export interface RecordChange {
  Action: 'UPSERT';
  ResourceRecordSet: {
    Name: string;
    Type: string;
    TTL: number;
    ResourceRecords: Array<{ Value: string }>;
  };
}

// Build one UPSERT entry for a change batch.
export function buildUpsert(
  name: string,
  type: string,
  ttl: number,
  values: string[],
): RecordChange {
  return {
    Action: 'UPSERT',
    ResourceRecordSet: {
      Name: name,
      Type: type,
      TTL: ttl,
      ResourceRecords: values.map((value) => ({ Value: value })),
    },
  };
}

// Apply a batch of changes to a hosted zone.
export async function applyChanges(
  config: InfraConfig,
  hostedZoneId: string,
  changes: RecordChange[],
  comment = 'bmail infra',
): Promise<void> {
  void config; // Region-less service; kept in the signature for symmetry.

  await runAws([
    'route53', 'change-resource-record-sets',
    '--hosted-zone-id', hostedZoneId,
    '--change-batch', JSON.stringify({ Comment: comment, Changes: changes }),
  ]);
}
