/**
 * insight.ts — Shape of the AI-generated insight attached to a message.
 *
 * Produced by the InsightProvider in the engine, stored serialized in the
 * `ai_insight` column, and rendered by the web UI. This is the parsed form;
 * on the wire it travels as a JSON string inside MessageEnvelope.aiInsight.
 */

export type EmailCategory =
  | 'notification'
  | 'personal'
  | 'work'
  | 'marketing'
  | 'transactional'
  | 'security';

export type EmailPriority = 'high' | 'medium' | 'low';

export interface EmailInsight {
  /** One-paragraph summary of the email */
  summary: string;
  /** Single line used in place of the raw preview in the list */
  previewLine: string;
  /** Cleaned-up sender display name */
  senderName: string;
  category: EmailCategory;
  priority: EmailPriority;
  actionRequired: boolean;
}
