/**
 * attachment-chips.tsx — Attachment chips shown under a message body.
 *
 * Pure presentation: each chip shows filename and size; clicking one calls
 * the onDownload callback. Fetching the bytes and triggering the browser
 * save is the app layer's job (client.downloadAttachment).
 */

import { Paperclip } from 'lucide-react';

import type { AttachmentInfo } from '@bmail/core/types';

import { formatFileSize } from '../lib/format.js';

interface AttachmentChipsProps {
  attachments: AttachmentInfo[];
  onDownload?: (attachment: AttachmentInfo) => void;
}

export function AttachmentChips({ attachments, onDownload }: AttachmentChipsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 border-t border-border/30 px-6 py-3">
      {attachments.map((attachment) => (
        <button
          key={attachment.partId}
          onClick={() => onDownload?.(attachment)}
          title={`Download ${attachment.filename}`}
          className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-left transition-colors hover:bg-muted/70 hover:border-border cursor-pointer"
        >
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground max-w-[180px] truncate">
            {attachment.filename}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatFileSize(attachment.size)}
          </span>
        </button>
      ))}
    </div>
  );
}
