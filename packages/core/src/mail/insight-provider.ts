/**
 * insight-provider.ts — Optional AI enrichment plugin for the sync engine.
 *
 * In bermail this was a module-level singleton (ai-service.ts) gated on
 * ANTHROPIC_API_KEY. Here it is a plain interface injected into SyncEngine:
 * pass no provider and the engine does zero AI work; pass a provider and
 * unprocessed messages get analyzed in the background.
 */

import type { EmailInsight } from '../types/index.js';

// ─── Plugin interface ──────────────────────────────────

export interface InsightProvider {
  /**
   * Analyze one email and return its insight, or null when the analysis
   * failed. Implementations must never throw — a broken AI must not break
   * mail sync.
   */
  analyzeEmail(subject: string, from: string, body: string): Promise<EmailInsight | null>;
}
