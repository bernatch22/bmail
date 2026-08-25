/**
 * anthropic-insight-provider.ts — InsightProvider backed by Claude Haiku.
 *
 * Structured email analysis: one API call per message, prompt asks for a
 * strict JSON object matching EmailInsight. Failures return null instead of
 * throwing — the sync loop must never die because the AI hiccuped.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { EmailInsight } from '../types/index.js';
import type { InsightProvider } from './insight-provider.js';

// Haiku: cheapest tier, plenty for classification/summarization.
const DEFAULT_MODEL = 'claude-haiku-4-5';

// Keep token usage bounded — an insight needs the gist, not the whole email.
const MAX_BODY_CHARS = 2000;

const SYSTEM_PROMPT = `You are an email analysis API. Given an email, return ONLY a raw JSON object. No markdown, no code fences, no explanation, no text outside the JSON.

{
  "summary": "One short sentence, max 15 words",
  "previewLine": "Catchy ultra-short inbox preview, max 10 words",
  "senderName": "Clean human name of the sender, never an email address",
  "category": "notification|personal|work|marketing|transactional|security",
  "priority": "high|medium|low",
  "actionRequired": true/false
}

Rules:
- Output MUST start with { and end with }
- No markdown, no backticks, no code fences
- senderName must NEVER contain < > or @`;

export class AnthropicInsightProvider implements InsightProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  /**
   * With no arguments the SDK resolves credentials from the environment
   * (ANTHROPIC_API_KEY et al). Pass an explicit client for tests.
   */
  constructor(options: { client?: Anthropic; model?: string } = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async analyzeEmail(
    subject: string,
    from: string,
    body: string,
  ): Promise<EmailInsight | null> {
    try {
      const truncatedBody = body.slice(0, MAX_BODY_CHARS);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `From: ${from}\nSubject: ${subject}\n\n${truncatedBody}`,
          },
        ],
      });

      let text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      // Strip markdown code fences if the model wrapped the JSON anyway.
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

      return JSON.parse(text) as EmailInsight;
    } catch (err) {
      console.error('  ✗ AI analysis failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }
}
