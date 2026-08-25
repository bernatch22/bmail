/**
 * index.ts — Public surface of @bmail/ui.
 *
 * Reusable React components for BMail clients. Presentation only: data and
 * actions travel through props/callbacks, so the same components work over
 * @bmail/client, a mock, or any other transport the host app chooses.
 */

// ─── Mail components ───────────────────────────────────

export { MailList } from './components/mail-list.js';
export { MailDisplay } from './components/mail-display.js';
export { ThreadMessage } from './components/thread-message.js';
export { SingleMessage } from './components/single-message.js';
export { MessageBody } from './components/message-body.js';
export { AttachmentChips } from './components/attachment-chips.js';
export { ComposePane } from './components/compose-pane.js';
export { NavSidebar } from './components/nav-sidebar.js';
export { ConfirmDialog } from './components/confirm-dialog.js';
export { ActionButton } from './components/action-button.js';

// ─── Layout ────────────────────────────────────────────

export { PaneGrid } from './components/pane-grid.js';
export { PaneHandle } from './components/pane-handle.js';
export { usePaneGrid, type PaneGridState, type PaneDef } from './hooks/use-pane-grid.js';
export { usePaneResize } from './hooks/use-pane-resize.js';

// ─── Primitives (shadcn-style) ─────────────────────────

export * from './primitives/alert-dialog.js';
export * from './primitives/badge.js';
export * from './primitives/button.js';
export * from './primitives/input.js';
export * from './primitives/scroll-area.js';
export * from './primitives/separator.js';
export * from './primitives/tabs.js';
export * from './primitives/tooltip.js';

// ─── Helpers and types ─────────────────────────────────

export { cn } from './lib/cn.js';
export { darkifyDocument } from './lib/darkify.js';
export {
  formatFullDate,
  formatShortDate,
  formatRelativeDate,
  formatFileSize,
  getInitials,
  getSenderName,
  parseInsight,
} from './lib/format.js';
export { stripTextQuotes, buildCollapseScript } from './lib/quotes.js';
export type { Theme, ComposeDraft, ComposeSubmission } from './types.js';
