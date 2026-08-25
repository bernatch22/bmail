/**
 * thread-message.tsx — One collapsible card of a conversation thread.
 *
 * Collapsed: a one-line row with avatar, sender, preview and date.
 * Expanded: full header, per-message actions (reply/trash), and the body.
 * A card whose body was not fetched yet asks the app for it through the
 * onLoadBody callback — no fetching happens here.
 */

import { useCallback, useState } from 'react';
import { ChevronDown, CornerUpLeft, Paperclip, Trash2 } from 'lucide-react';

import type { AttachmentInfo, FullMessage } from '@bmail/contract';
import { extractAddress } from '@bmail/domain';

import { Badge } from '../primitives/badge.js';
import { formatFullDate, formatShortDate, getInitials, getSenderName, parseInsight } from '../lib/format.js';
import type { Theme } from '../types.js';
import { ActionButton } from './action-button.js';
import { MessageBody } from './message-body.js';

interface ThreadMessageProps {
  message: FullMessage;
  isLatest: boolean;
  index: number;
  theme: Theme;
  /** Logged-in address, for the "Me" treatment on sent messages. */
  myEmail: string;
  onReplyMessage?: (message: FullMessage) => void;
  onTrashMessage?: (message: FullMessage) => void;
  /** Fetch the full body of a card whose row came without one. */
  onLoadBody?: (message: FullMessage) => Promise<void>;
  onDownloadAttachment?: (message: FullMessage, attachment: AttachmentInfo) => void;
}

export function ThreadMessage({
  message, isLatest, index, theme, myEmail,
  onReplyMessage, onTrashMessage, onLoadBody, onDownloadAttachment,
}: ThreadMessageProps) {
  const [expanded, setExpanded] = useState(isLatest);
  const [loading, setLoading] = useState(false);

  const hasBody = Boolean(message.htmlBody || message.textBody);
  const insight = parseInsight(message);
  const isSent = Boolean(myEmail) && extractAddress(message.from) === myEmail.toLowerCase();
  const senderName = isSent ? 'Me' : (insight?.senderName || getSenderName(message.from));
  const avatarClasses = isSent
    ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
    : 'bg-primary/10 text-primary';
  const isEven = index % 2 === 0;

  const handleExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    setExpanded(true);
    if (!hasBody && onLoadBody) {
      setLoading(true);
      try {
        await onLoadBody(message);
      } catch (err) {
        console.error('Failed to load message body:', err);
      }
      setLoading(false);
    }
  }, [expanded, hasBody, message, onLoadBody]);

  if (!expanded) {
    return (
      <button
        onClick={handleExpand}
        className={`flex items-center gap-3 px-6 py-2.5 border-b border-border/30 hover:bg-muted/50 transition-colors text-left w-full cursor-pointer ${
          isEven ? 'bg-muted/20 dark:bg-muted/10' : ''
        }`}
      >
        <div className={'h-7 w-7 rounded-full text-[10px] flex items-center justify-center shrink-0 font-medium ' + avatarClasses}>
          {isSent ? 'Me' : getInitials(insight?.senderName || getSenderName(message.from))}
        </div>
        <span className="text-[13px] font-medium text-foreground truncate w-28 shrink-0">
          {senderName}
        </span>
        <span className="text-[12px] text-muted-foreground truncate flex-1">
          {insight?.previewLine || message.preview || '...'}
        </span>
        <span className="text-[11px] text-muted-foreground/60 tabular-nums shrink-0">
          {formatShortDate(message.date)}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground/40 shrink-0" />
      </button>
    );
  }

  return (
    <div className={`border-b ${isEven ? 'bg-muted/15 dark:bg-muted/8' : ''}`}>
      <div
        onClick={handleExpand}
        className="flex items-start gap-3 px-6 py-3 hover:bg-muted/20 transition-colors text-left w-full cursor-pointer"
      >
        <div className={'h-9 w-9 rounded-full text-xs flex items-center justify-center shrink-0 font-medium mt-0.5 ' + avatarClasses}>
          {isSent ? 'Me' : getInitials(insight?.senderName || getSenderName(message.from))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{senderName}</span>
            {isSent && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400">sent</span>}
            <span className="text-[11px] text-muted-foreground">{formatFullDate(message.date)}</span>
          </div>
          {message.to && (
            <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">
              to {message.to.replace(/<[^>]+>/g, '').trim()}
            </p>
          )}
        </div>
        {message.hasAttachments && (
          <Badge variant="outline" className="text-[10px] gap-1 shrink-0 h-5">
            <Paperclip className="h-2.5 w-2.5" />
          </Badge>
        )}
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {onReplyMessage && (
            <ActionButton icon={CornerUpLeft} label="Reply to this message" onClick={() => onReplyMessage(message)} />
          )}
          {onTrashMessage && (
            <ActionButton icon={Trash2} label="Trash this message" variant="destructive" onClick={() => onTrashMessage(message)} />
          )}
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <MessageBody message={message} theme={theme} onDownloadAttachment={onDownloadAttachment} />
      )}
    </div>
  );
}
