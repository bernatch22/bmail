/**
 * logger.ts — the logging seam between @bmail/admin and whoever hosts it.
 *
 * Infra operations must stay pure of CLI concerns: no console, no colors,
 * no prompts. Instead every operation that wants to narrate progress takes
 * an InfraLogger. The CLI passes one that writes colored lines to stderr;
 * a server or an MCP tool can pass a structured logger or the silent one.
 */

// ── the interface ─────────────────────────────────────────────────────────────

export interface InfraLogger {
  // A step about to happen ("SES: create identity …").
  step(message: string): void;

  // A step that finished well.
  ok(message: string): void;

  // Non-fatal, worth a human's attention.
  warn(message: string): void;

  // Low-importance detail (hints, propagation notes).
  detail(message: string): void;
}

// ── a default that says nothing ───────────────────────────────────────────────

// Used when the caller does not care about narration (tests, batch jobs).
export const silentLogger: InfraLogger = {
  step() {},
  ok() {},
  warn() {},
  detail() {},
};
