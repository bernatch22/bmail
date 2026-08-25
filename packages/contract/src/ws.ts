/**
 * ws.ts — WebSocket event contract between server and clients.
 *
 * Kept deliberately loose (payload is an open record) because events are
 * fan-out notifications: clients re-fetch through the HTTP API rather than
 * trusting the payload as the source of truth.
 */

export type WsEventType =
  | 'connected'
  | 'new_message'
  | 'mailbox_update'
  | 'sync_update';

export interface WsEvent {
  type: WsEventType;
  payload: Record<string, unknown>;
}

// ─── Helpers ───────────────────────────────────────────

const ALL_WS_EVENT_TYPES: readonly WsEventType[] = [
  'connected',
  'new_message',
  'mailbox_update',
  'sync_update',
];

/**
 * Runtime guard for data arriving over the socket. The wire gives us
 * `unknown`; this narrows it before the client dispatches on `type`.
 */
export function isWsEvent(value: unknown): value is WsEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { type?: unknown; payload?: unknown };

  const hasKnownType =
    typeof candidate.type === 'string' &&
    (ALL_WS_EVENT_TYPES as readonly string[]).includes(candidate.type);

  const hasObjectPayload =
    typeof candidate.payload === 'object' && candidate.payload !== null;

  return hasKnownType && hasObjectPayload;
}
