/**
 * single-message.tsx — Header + body for a one-message conversation.
 *
 * Used by MailDisplay when the thread has a single message, so there is
 * nothing to collapse.
 */

import { Paperclip } from 'lucide-react';

import type { AttachmentInfo, FullMessage } from '@bmail/core/types';
import { extractAddress } from '@bmail/core/logic';

import { Badge } from '../primitives/badge.js';
import { formatFullDate, getInitials, getSenderName, parseInsight } from '../lib/format.js';
import type { Theme } from '../types.js';
import { MessageBody } from './message-body.js';

interface SingleMessageProps {
  message: FullMessage;
  theme: Theme;
  myEmail: string;
  onDownloadAttachment?: (message: FullMessage, attachment: AttachmentInfo) => void;
}

export function SingleMessage({ message, theme, myEmail, onDownloadAttachment }: SingleMessageProps) {
  const insight = parseInsight(message);
  const isSent = Boolean(myEmail) && extractAddress(message.from) === myEmail.toLowerCase();
  const senderName = isSent ? 'Me' : (insight?.senderName || getSenderName(message.from));
  const avatarClasses = isSent
    ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
    : 'bg-primary/10 text-primary';

  return (
    <div>
      <div className="px-6 py-3 border-b">
        <div className="flex items-start gap-3">
          <div className={'h-9 w-9 rounded-full text-xs flex items-center justify-center shrink-0 font-medium ' + avatarClasses}>
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
            <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
              <Paperclip className="h-3 w-3" /> Attachments
            </Badge>
          )}
        </div>
      </div>
      <MessageBody message={message} theme={theme} onDownloadAttachment={onDownloadAttachment} />
    </div>
  );
}
