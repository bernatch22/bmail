/**
 * change-notifier.ts — Transport-agnostic push interface.
 *
 * The engine needs to tell "whoever is listening for user X" that something
 * changed, but it must not know about WebSockets. The actual per-user
 * WebSocket fan-out hub (bermail's ws-hub.ts) is server wiring and moves to
 * apps/server in step 5 — it will simply implement this interface.
 *
 * A NullChangeNotifier is provided for CLIs/tests that need no push at all.
 */

import type { WsEvent } from '@bmail/contract';

// ─── Interface ─────────────────────────────────────────

export interface ChangeNotifier {
  /** Deliver an event to every live listener of one user. Fire-and-forget. */
  sendToUser(userId: string, event: WsEvent): void;
}

// ─── No-op implementation ──────────────────────────────

/** Swallows every event. Useful for CLIs, tests and one-shot tools. */
export class NullChangeNotifier implements ChangeNotifier {
  sendToUser(): void {
    // Intentionally empty: nobody is listening.
  }
}
