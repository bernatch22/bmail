/**
 * mail-list.tsx — Gmail-style message list with thread grouping.
 *
 * Groups the folder's envelopes into conversations, with search and an
 * all/unread filter kept as local UI state. Data (messages, paging,
 * selection) and actions arrive through props — no store, no fetch.
 */

import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';

import type { MessageEnvelope } from '@bmail/core/types';
import { extractAddress } from '@bmail/core/logic';

import { cn } from '../lib/cn.js';
import { formatRelativeDate, getInitials, getSenderName, parseInsight } from '../lib/format.js';
import { Input } from '../primitives/input.js';
import { ScrollArea } from '../primitives/scroll-area.js';
import { Separator } from '../primitives/separator.js';
import { Tabs, TabsList, TabsTrigger } from '../primitives/tabs.js';

// ─── Folder display names ──────────────────────────────

const FOLDER_NAMES: Record<string, string> = {
  'INBOX': 'Inbox',
  'Drafts': 'Drafts',
  'Sent Items': 'Sent',
  'Sent': 'Sent',
  'Junk Email': 'Junk',
  'Junk': 'Junk',
  'Deleted Items': 'Trash',
  'Trash': 'Trash',
  'Archive': 'Archive',
};

function folderDisplayName(folder: string): string {
  return FOLDER_NAMES[folder] ?? folder;
}

// ─── Thread grouping ───────────────────────────────────

interface Thread {
  threadId: string;
  subject: string;
  messages: MessageEnvelope[];
  latestDate: string | null;
  hasUnread: boolean;
  participants: string[];
}

function getAiSenderName(message: MessageEnvelope): string {
  const insight = parseInsight(message);
  return insight?.senderName || getSenderName(message.from);
}

function isFromMe(message: MessageEnvelope, myEmail: string): boolean {
  return Boolean(myEmail) && extractAddress(message.from) === myEmail.toLowerCase();
}

function groupThreads(messages: MessageEnvelope[], myEmail: string): Thread[] {
  const map = new Map<string, MessageEnvelope[]>();

  for (const message of messages) {
    const threadId = message.threadId || message.subject;
    const list = map.get(threadId) ?? [];
    list.push(message);
    map.set(threadId, list);
  }

  const threads: Thread[] = [];

  for (const [threadId, threadMessages] of map) {
    threadMessages.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateA - dateB;
    });

    const latest = threadMessages[threadMessages.length - 1];
    const participantSet = new Set<string>();
    threadMessages.forEach((message) => {
      participantSet.add(isFromMe(message, myEmail) ? 'Me' : getAiSenderName(message));
    });

    threads.push({
      threadId,
      subject: latest.subject.replace(/^(Re:\s*|Fwd:\s*|FW:\s*)+/gi, '').trim() || latest.subject,
      messages: threadMessages,
      latestDate: latest.date,
      hasUnread: threadMessages.some((message) => !message.seen),
      participants: Array.from(participantSet),
    });
  }

  threads.sort((a, b) => {
    const dateA = a.latestDate ? new Date(a.latestDate).getTime() : 0;
    const dateB = b.latestDate ? new Date(b.latestDate).getTime() : 0;
    return dateB - dateA;
  });

  return threads;
}

// ─── Component ─────────────────────────────────────────

interface MailListProps {
  folder: string;
  messages: MessageEnvelope[];
  loading: boolean;
  /** Logged-in address, for the "Me" treatment on sent messages. */
  myEmail: string;
  /** Thread identity of the selected conversation, for the highlight. */
  selectedThreadId?: string;
  page: number;
  totalPages: number;
  onSelectMessage: (message: MessageEnvelope) => void;
  onPageChange: (page: number) => void;
  onCompose?: () => void;
}

export function MailList({
  folder, messages, loading, myEmail, selectedThreadId,
  page, totalPages, onSelectMessage, onPageChange, onCompose,
}: MailListProps) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');

  const filtered = messages.filter((message) => {
    const matchesSearch =
      !search ||
      message.subject.toLowerCase().includes(search.toLowerCase()) ||
      message.from.toLowerCase().includes(search.toLowerCase());
    const matchesTab = tab === 'all' || !message.seen;
    return matchesSearch && matchesTab;
  });

  const threads = useMemo(() => groupThreads(filtered, myEmail), [filtered, myEmail]);

  return (
    <div className="flex h-full flex-col border-r min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 className="text-lg tracking-tight text-foreground">
          {folderDisplayName(folder)}
        </h2>
        {onCompose && (
          <button
            onClick={onCompose}
            title="New Email"
            className="h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer transition-colors"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search messages..."
            className="pl-8 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="px-4">
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">All mail</TabsTrigger>
          <TabsTrigger value="unread" className="flex-1">Unread</TabsTrigger>
        </TabsList>
      </Tabs>

      <Separator className="mt-2" />

      {/* Threads */}
      <ScrollArea className="flex-1 min-w-0 w-full overflow-hidden">
        <div className="flex flex-col gap-1 p-2 w-full overflow-hidden">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-md border p-3 animate-pulse">
                <div className="h-3 w-2/3 bg-muted rounded mb-2" />
                <div className="h-3 w-1/3 bg-muted rounded" />
              </div>
            ))
          ) : threads.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No messages
            </p>
          ) : (
            threads.map((thread) => {
              const latest = thread.messages[thread.messages.length - 1];
              const latestIsSent = isFromMe(latest, myEmail);

              return (
                <div key={thread.threadId} className="flex flex-col">
                  <button
                    onClick={() => onSelectMessage(latest)}
                    className={cn(
                      'flex flex-col items-start gap-1.5 rounded-lg p-3 text-left text-sm w-full min-w-0 overflow-hidden cursor-pointer',
                      'transition-all duration-150 hover:bg-accent/60',
                      selectedThreadId && thread.threadId === selectedThreadId && 'bg-accent/80',
                      thread.hasUnread && 'border-l-2 border-l-orange-400',
                    )}
                  >
                    <div className="flex w-full items-center gap-2.5 min-w-0">
                      {/* Avatar */}
                      <div className="relative flex-shrink-0" style={{ width: thread.messages.length > 1 ? 38 : 32, height: 32 }}>
                        {thread.participants.slice(0, 2).map((name, i) => (
                          <div
                            key={name}
                            className={cn(
                              'absolute flex items-center justify-center rounded-full text-[10px] font-semibold border-2 border-background',
                              name === 'Me'
                                ? 'bg-orange-100 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400'
                                : thread.hasUnread
                                ? 'bg-orange-100 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400'
                                : 'bg-muted text-muted-foreground',
                            )}
                            style={{
                              width: 28,
                              height: 28,
                              left: i * 10,
                              zIndex: 2 - i,
                            }}
                          >
                            {i === 0 && getInitials(name)}
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-1 flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            'truncate text-sm',
                            thread.hasUnread ? 'font-semibold text-foreground' : 'text-foreground/80',
                          )}>
                            {thread.participants.slice(0, 3).join(', ')}
                          </span>
                          {thread.messages.length > 1 && (
                            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground flex-shrink-0">
                              {thread.messages.length}
                            </span>
                          )}
                        </div>
                        <span className={cn(
                          'truncate text-[13px]',
                          thread.hasUnread ? 'font-medium text-foreground' : 'text-foreground/70',
                        )}>
                          {thread.subject || '(no subject)'}
                        </span>
                        {(() => {
                          const insight = parseInsight(latest);
                          const preview = insight?.previewLine || latest.preview;
                          return preview ? (
                            <span className="truncate text-[11px] text-muted-foreground/70 mt-0.5">
                              {latestIsSent && <span className="text-orange-500 font-medium">Me: </span>}
                              {preview}
                            </span>
                          ) : null;
                        })()}
                      </div>

                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {formatRelativeDate(thread.latestDate)}
                        </span>
                        {thread.hasUnread && (
                          <span className="h-2 w-2 rounded-full bg-orange-500" />
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="hover:text-foreground disabled:opacity-30 transition-colors"
          >
            ← Prev
          </button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="hover:text-foreground disabled:opacity-30 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
