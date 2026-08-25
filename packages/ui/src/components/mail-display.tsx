/**
 * mail-display.tsx — Gmail-style conversation view.
 *
 * Split out of bermail's 638-line mail-display.tsx: this file is now
 * presentation only. The toolbar, the confirmation dialogs and the thread
 * layout live here; every action (trash, archive, flag, read toggle,
 * per-message trash, body loading, attachment download) is a callback the
 * host app implements over @bmail/client, together with any optimistic
 * store updates.
 */

import { useState } from 'react';
import {
  Archive,
  CornerUpLeft,
  CornerUpRight,
  FileText,
  Flag,
  Languages,
  Mail,
  MailOpen,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import type { AttachmentInfo, FullMessage } from '@bmail/contract';

import { Button } from '../primitives/button.js';
import { ScrollArea } from '../primitives/scroll-area.js';
import { Separator } from '../primitives/separator.js';
import { parseInsight } from '../lib/format.js';
import type { Theme } from '../types.js';
import { ActionButton } from './action-button.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { SingleMessage } from './single-message.js';
import { ThreadMessage } from './thread-message.js';

interface MailDisplayProps {
  /** Selected (latest) message of the conversation, or null. */
  message: FullMessage | null;
  /** Full conversation, sorted by date ascending. */
  thread: FullMessage[];
  loading: boolean;
  theme: Theme;
  /** Logged-in address, for the "Me" treatment on sent messages. */
  myEmail: string;
  /** Whether any inbox message of the thread is unread (drives the toggle). */
  threadHasUnread: boolean;

  onClose: () => void;
  onReply?: () => void;
  onReplyMessage?: (message: FullMessage) => void;
  onForward?: () => void;

  /** Thread-wide actions; confirmation happens here, execution in the app. */
  onTrashThread: () => void;
  onArchiveThread: () => void;
  onFlagThread: () => void;
  onToggleRead: () => void;

  /** Trash ONE message of the thread (confirmed here first). */
  onTrashMessage?: (message: FullMessage) => void;
  /** Fetch the full body of a thread card that came without one. */
  onLoadMessageBody?: (message: FullMessage) => Promise<void>;
  onDownloadAttachment?: (message: FullMessage, attachment: AttachmentInfo) => void;
}

export function MailDisplay({
  message, thread, loading, theme, myEmail, threadHasUnread,
  onClose, onReply, onReplyMessage, onForward,
  onTrashThread, onArchiveThread, onFlagThread, onToggleRead,
  onTrashMessage, onLoadMessageBody, onDownloadAttachment,
}: MailDisplayProps) {
  // Confirmation dialog state is pure UI concern, so it stays here.
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [trashTarget, setTrashTarget] = useState<FullMessage | null>(null);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!message) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Select a message to read</p>
        </div>
      </div>
    );
  }

  const subject = message.subject?.replace(/^(Re:\s*|Fwd:\s*|FW:\s*)+/gi, '').trim() || message.subject;
  const latestInsight = parseInsight(message);

  return (
    <div className="flex h-full flex-col">
      {/* Top toolbar */}
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <div className="flex items-center gap-1">
          <ActionButton icon={CornerUpLeft} label="Reply" onClick={onReply} />
          <ActionButton icon={CornerUpRight} label="Forward" onClick={onForward} />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ActionButton icon={Archive} label="Archive" onClick={() => setConfirmArchive(true)} />
          <ActionButton icon={Flag} label="Flag" onClick={onFlagThread} />
          <ActionButton
            icon={!threadHasUnread ? MailOpen : Mail}
            label={!threadHasUnread ? 'Mark unread' : 'Mark read'}
            onClick={onToggleRead}
          />
          <ActionButton icon={Trash2} label="Trash" variant="destructive" onClick={() => setConfirmTrash(true)} />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ActionButton icon={Sparkles} label="AI Summarize" />
          <ActionButton icon={FileText} label="AI Draft reply" />
          <ActionButton icon={Languages} label="Translate" />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Confirmation dialogs */}
      <ConfirmDialog
        open={confirmTrash}
        onOpenChange={setConfirmTrash}
        onConfirm={onTrashThread}
        title="Move to Trash"
        description="This message will be moved to the Trash folder. You can restore it later."
        confirmLabel="Move to Trash"
        icon={Trash2}
      />
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        onConfirm={onArchiveThread}
        title="Archive Message"
        description="This message will be moved to Archive. It won't appear in your inbox."
        confirmLabel="Archive"
        icon={Archive}
        variant="default"
      />
      <ConfirmDialog
        open={trashTarget !== null}
        onOpenChange={(open) => { if (!open) setTrashTarget(null); }}
        onConfirm={() => {
          if (trashTarget) onTrashMessage?.(trashTarget);
          setTrashTarget(null);
        }}
        title="Move message to Trash"
        description="Only this message will be moved to Trash. The rest of the conversation stays."
        confirmLabel="Move to Trash"
        icon={Trash2}
      />

      {/* Thread subject header */}
      <div className="border-b px-6 py-3">
        <h2 className="text-base font-semibold text-foreground">
          {subject || '(no subject)'}
        </h2>
        {latestInsight?.summary && (
          <p className="mt-1 text-xs text-muted-foreground/70 italic">
            ✨ {latestInsight.summary}
          </p>
        )}
        {thread.length > 1 && (
          <span className="text-[11px] text-muted-foreground mt-1 inline-block">
            {thread.length} messages in this conversation
          </span>
        )}
      </div>

      {/* Thread messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col">
          {thread.length > 1 ? (
            thread.map((threadMessage, i) => (
              <ThreadMessage
                key={`${threadMessage.folder ?? ''}:${threadMessage.uid}`}
                message={threadMessage}
                isLatest={i === thread.length - 1}
                index={i}
                theme={theme}
                myEmail={myEmail}
                onReplyMessage={onReplyMessage}
                onTrashMessage={onTrashMessage ? setTrashTarget : undefined}
                onLoadBody={onLoadMessageBody}
                onDownloadAttachment={onDownloadAttachment}
              />
            ))
          ) : (
            <SingleMessage
              message={message}
              theme={theme}
              myEmail={myEmail}
              onDownloadAttachment={onDownloadAttachment}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
