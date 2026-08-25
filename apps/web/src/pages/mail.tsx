/**
 * mail.tsx — The mail page: wires @bmail/ui components to the SDK.
 *
 * This is where the SPA earns the word "thin": every callback the UI
 * components expose is implemented here over @bmail/client, with the
 * optimistic store updates that used to live inside the components.
 * Reply/forward semantics come from @bmail/domain, not inline regexes.
 */

import { useCallback, useEffect } from 'react';
import type { NavigateFunction } from 'react-router';

import type { AttachmentInfo, FullMessage, MessageEnvelope } from '@bmail/contract';
import {
  buildForwardSubject,
  buildReplySubject,
  folderToSlug,
  resolveReplyRecipients,
} from '@bmail/domain';
import type { OutgoingAttachment } from '@bmail/client';
import {
  ComposePane,
  MailDisplay,
  MailList,
  NavSidebar,
  PaneGrid,
  usePaneGrid,
  type ComposeDraft,
  type ComposeSubmission,
} from '@bmail/ui';

import { useAuth } from '../auth.js';
import { client } from '../lib/client.js';
import { useStore } from '../store.js';

// ─── Helpers ───────────────────────────────────────────

/** Thread identity of a message: threadId, subject as legacy fallback. */
function threadIdOf(message: Pick<MessageEnvelope, 'threadId' | 'subject'>): string {
  return message.threadId || message.subject;
}

/**
 * Real folder of a thread message. The thread endpoint marks cross-folder
 * sent copies with "__sent__", which is a marker, not an IMAP path.
 */
function folderOf(message: FullMessage, currentFolder: string): string {
  if (message.folder && message.folder !== '__sent__') {
    return message.folder;
  }
  return currentFolder;
}

/** Encode a picked File as the base64 attachment shape the API expects. */
async function fileToOutgoingAttachment(file: File): Promise<OutgoingAttachment> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // btoa needs a binary string; build it in chunks to avoid call-stack
  // limits from String.fromCharCode(...hugeArray).
  let binary = '';
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }

  return {
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    contentBase64: btoa(binary),
  };
}

/** Content types the browser can render by itself, worth a preview tab. */
function isPreviewable(contentType: string): boolean {
  return contentType.startsWith('image/')
    || contentType === 'application/pdf'
    || contentType.startsWith('text/');
}

/** Hand downloaded bytes to the browser as a file save. */
function saveBlob(bytes: Uint8Array, contentType: string, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: contentType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking synchronously kills the download in Safari before it starts;
  // defer it long enough for the save to begin.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Open previewable bytes (images, PDFs, text) in a new tab. */
function previewBlob(bytes: Uint8Array, contentType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: contentType });
  const url = URL.createObjectURL(blob);

  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ─── Page ──────────────────────────────────────────────

interface MailPageProps {
  navigate: NavigateFunction;
}

export function MailPage({ navigate }: MailPageProps) {
  const { state, dispatch } = useStore();
  const { user, logout } = useAuth();
  const grid = usePaneGrid();

  const myEmail = user?.email ?? '';
  const folder = state.currentFolder;

  // Sync compose pane visibility — hide if no compose state
  useEffect(() => {
    if (!state.compose && grid.panes.find((pane) => pane.id === 'compose')?.visible) {
      grid.hidePane('compose');
    }
  }, [state.compose]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Folder / list loading ───────────────────────────

  const loadMessages = useCallback(
    async (targetFolder: string, page: number) => {
      dispatch({ type: 'SET_LOADING', payload: true });
      try {
        const result = await client.listMessages(targetFolder, { page, limit: state.pageSize });
        dispatch({
          type: 'SET_MESSAGES',
          payload: { messages: result.data, total: result.total, page },
        });
      } catch (err: unknown) {
        console.error('Failed to load:', err instanceof Error ? err.message : err);
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    },
    [dispatch, state.pageSize],
  );

  const handleSelectFolder = useCallback(
    (targetFolder: string) => {
      dispatch({ type: 'SELECT_FOLDER', payload: targetFolder });
      navigate(`/${folderToSlug(targetFolder)}`);
      loadMessages(targetFolder, 1);
    },
    [dispatch, loadMessages, navigate],
  );

  const handlePageChange = useCallback(
    (page: number) => loadMessages(folder, page),
    [loadMessages, folder],
  );

  // ─── Conversation selection ──────────────────────────

  const handleSelectMessage = useCallback(
    async (envelope: MessageEnvelope) => {
      dispatch({ type: 'SET_LOADING_MESSAGE', payload: true });
      try {
        // Fetch full thread from API (cross-folder: includes sent messages)
        const threadId = threadIdOf(envelope);
        const thread = await client.getThread(threadId);

        // Latest message is the last one (sorted by date ASC from API)
        const latest = thread[thread.length - 1] ?? (envelope as FullMessage);

        dispatch({ type: 'SELECT_MESSAGE', payload: latest });
        dispatch({ type: 'SET_THREAD', payload: thread });

        // Deep-link with a uid that belongs to the CURRENT folder — uids are
        // per-folder, and the thread's latest message can live in Sent.
        const inFolder = state.messages.filter(
          (message) => threadIdOf(message) === threadId && message.folder !== '__sent__',
        );
        const urlUid = inFolder.length > 0 ? inFolder[inFolder.length - 1].uid : envelope.uid;
        navigate(`/${folderToSlug(folder)}/${urlUid}`, { replace: true });

        // Mark unread inbox messages as read (API + local state) — skip sent cross-folder
        for (const message of state.messages) {
          if (!message.seen && message.folder !== '__sent__' && threadIdOf(message) === threadId) {
            client.markSeen(folder, message.uid).catch(console.error);
            dispatch({ type: 'MARK_READ', payload: { folder, uid: message.uid } });
          }
        }
      } catch (err: unknown) {
        console.error('Failed to load:', err instanceof Error ? err.message : err);
        dispatch({ type: 'SET_LOADING_MESSAGE', payload: false });
      }
    },
    [dispatch, folder, state.messages, navigate],
  );

  const handleCloseMessage = useCallback(() => {
    dispatch({ type: 'CLEAR_MESSAGE' });
    navigate(`/${folderToSlug(folder)}`, { replace: true });
  }, [dispatch, navigate, folder]);

  // ─── Thread-wide actions ─────────────────────────────

  // The current-folder rows of the selected conversation (sent copies excluded).
  const selectedThreadId = state.selectedMessage ? threadIdOf(state.selectedMessage) : undefined;
  const inboxThreadMessages = state.messages.filter(
    (message) => selectedThreadId !== undefined
      && threadIdOf(message) === selectedThreadId
      && message.folder !== '__sent__',
  );
  const threadHasUnread = inboxThreadMessages.some((message) => !message.seen);

  /** Optimistically drop the thread's rows, then fire one API call per row. */
  const runThreadAction = useCallback(
    (action: (actionFolder: string, uid: number) => Promise<void>) => {
      const uidsToRemove = new Set(inboxThreadMessages.map((message) => message.uid));
      dispatch({
        type: 'SET_MESSAGES',
        payload: {
          messages: state.messages.filter((message) => !uidsToRemove.has(message.uid)),
          total: state.totalMessages - uidsToRemove.size,
          page: state.currentPage,
        },
      });
      handleCloseMessage();

      for (const message of inboxThreadMessages) {
        action(folder, message.uid).catch(console.error);
      }
    },
    [inboxThreadMessages, folder, state.messages, state.totalMessages, state.currentPage, dispatch, handleCloseMessage],
  );

  const handleTrashThread = useCallback(
    () => runThreadAction((f, uid) => client.trash(f, uid)),
    [runThreadAction],
  );

  const handleArchiveThread = useCallback(
    () => runThreadAction((f, uid) => client.archive(f, uid)),
    [runThreadAction],
  );

  const handleFlagThread = useCallback(() => {
    for (const message of inboxThreadMessages) {
      client.flag(folder, message.uid).catch(console.error);
    }
  }, [inboxThreadMessages, folder]);

  const handleToggleRead = useCallback(() => {
    const newSeen = threadHasUnread;

    // Optimistic: update UI immediately
    const uidsToUpdate = new Set(inboxThreadMessages.map((message) => message.uid));
    dispatch({
      type: 'SET_MESSAGES',
      payload: {
        messages: state.messages.map((message) =>
          uidsToUpdate.has(message.uid) ? { ...message, seen: newSeen } : message,
        ),
        total: state.totalMessages,
        page: state.currentPage,
      },
    });
    handleCloseMessage();

    // Background: fire API calls
    for (const message of inboxThreadMessages) {
      client.markSeen(folder, message.uid, newSeen).catch(console.error);
    }
  }, [threadHasUnread, inboxThreadMessages, folder, state.messages, state.totalMessages, state.currentPage, dispatch, handleCloseMessage]);

  // ─── Per-message actions ─────────────────────────────

  // Trash ONE message of the thread (each thread message carries its folder).
  const handleTrashMessage = useCallback((message: FullMessage) => {
    const messageFolder = folderOf(message, folder);
    client.trash(messageFolder, message.uid).catch(console.error);

    const remaining = state.threadMessages.filter(
      (threadMessage) => !(threadMessage.uid === message.uid && folderOf(threadMessage, folder) === messageFolder),
    );
    dispatch({ type: 'SET_THREAD', payload: remaining });

    if (messageFolder === folder) {
      dispatch({
        type: 'SET_MESSAGES',
        payload: {
          messages: state.messages.filter(
            (row) => row.uid !== message.uid || (row.folder !== undefined && row.folder !== messageFolder),
          ),
          total: Math.max(0, state.totalMessages - 1),
          page: state.currentPage,
        },
      });
    }

    if (remaining.length === 0) {
      handleCloseMessage();
    } else if (
      state.selectedMessage
      && state.selectedMessage.uid === message.uid
      && folderOf(state.selectedMessage, folder) === messageFolder
    ) {
      dispatch({ type: 'SELECT_MESSAGE', payload: remaining[remaining.length - 1] });
    }
  }, [folder, state.threadMessages, state.selectedMessage, state.messages, state.totalMessages, state.currentPage, dispatch, handleCloseMessage]);

  const handleLoadMessageBody = useCallback(async (message: FullMessage) => {
    const full = await client.getMessage(folderOf(message, folder), message.uid);
    dispatch({ type: 'SET_THREAD_MESSAGE', payload: full });
  }, [folder, dispatch]);

  const handleDownloadAttachment = useCallback(async (message: FullMessage, attachment: AttachmentInfo) => {
    try {
      const downloaded = await client.downloadAttachment(
        folderOf(message, folder),
        message.uid,
        attachment.partId,
      );
      // Previewable types (images, PDFs, text) open in a new tab; anything
      // else goes straight to a file save.
      if (isPreviewable(downloaded.contentType)) {
        previewBlob(downloaded.bytes, downloaded.contentType);
      } else {
        saveBlob(downloaded.bytes, downloaded.contentType, downloaded.filename || attachment.filename);
      }
    } catch (err: unknown) {
      console.error('Attachment download failed:', err instanceof Error ? err.message : err);
    }
  }, [folder]);

  // ─── Compose ─────────────────────────────────────────

  // Reply to a specific message (Gmail-style, per thread card). WHO the
  // reply goes to — including the self-addressed corner case — is decided
  // by @bmail/domain, where it is unit-tested.
  const handleReplyMessage = useCallback((message: FullMessage) => {
    const recipients = resolveReplyRecipients(message, state.threadMessages, myEmail);

    const draft: ComposeDraft = {
      mode: 'reply',
      to: recipients.to,
      cc: '',
      subject: buildReplySubject(message.subject),
      body: '',
      quotedHtml: message.htmlBody || `<p>${message.textBody}</p>`,
      inReplyTo: recipients.inReplyTo,
      source: {
        from: message.from,
        date: message.date,
        subject: message.subject,
        threadId: threadIdOf(message),
      },
    };
    dispatch({ type: 'START_COMPOSE', payload: draft });
    grid.showPane('compose');
  }, [state.threadMessages, myEmail, dispatch, grid]);

  const handleReply = useCallback(() => {
    if (state.selectedMessage) handleReplyMessage(state.selectedMessage);
  }, [state.selectedMessage, handleReplyMessage]);

  const handleForward = useCallback(() => {
    const message = state.selectedMessage;
    if (!message) return;

    const draft: ComposeDraft = {
      mode: 'forward',
      to: '',
      cc: '',
      subject: buildForwardSubject(message.subject),
      body: '',
      quotedHtml: message.htmlBody || `<p>${message.textBody}</p>`,
      source: {
        from: message.from,
        date: message.date,
        subject: message.subject,
        threadId: threadIdOf(message),
      },
    };
    dispatch({ type: 'START_COMPOSE', payload: draft });
    grid.showPane('compose');
  }, [state.selectedMessage, dispatch, grid]);

  const handleNewCompose = useCallback(() => {
    const draft: ComposeDraft = {
      mode: 'new',
      to: '',
      cc: '',
      subject: '',
      body: '',
      quotedHtml: '',
    };
    dispatch({ type: 'START_COMPOSE', payload: draft });
    grid.showPane('compose');
  }, [dispatch, grid]);

  const handleCloseCompose = useCallback(() => {
    dispatch({ type: 'CLOSE_COMPOSE' });
    grid.hidePane('compose');
  }, [dispatch, grid]);

  // Encode picked files, send through the SDK, and optimistically add the
  // sent copy to the open thread and the list.
  const handleSend = useCallback(async (submission: ComposeSubmission) => {
    const attachments = await Promise.all(submission.files.map(fileToOutgoingAttachment));

    const { message: sentMessage } = await client.send({
      to: submission.to,
      cc: submission.cc,
      subject: submission.subject,
      html: submission.html,
      text: submission.text,
      threadId: submission.threadId ?? state.selectedMessage?.threadId,
      inReplyTo: submission.inReplyTo,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (state.threadMessages.length > 0) {
      dispatch({ type: 'SET_THREAD', payload: [...state.threadMessages, sentMessage] });
    }
    dispatch({
      type: 'SET_MESSAGES',
      payload: {
        messages: [...state.messages, { ...sentMessage, preview: sentMessage.textBody?.slice(0, 100) }],
        total: state.totalMessages,
        page: state.currentPage,
      },
    });
  }, [state.selectedMessage, state.threadMessages, state.messages, state.totalMessages, state.currentPage, dispatch]);

  // ─── Layout ──────────────────────────────────────────

  const totalPages = Math.ceil(state.totalMessages / state.pageSize);

  return (
    <div className="flex h-screen w-screen min-w-0">
      {/* Fixed dock sidebar */}
      <NavSidebar
        mailboxes={state.mailboxes}
        currentFolder={folder}
        theme={state.theme}
        userEmail={myEmail}
        onSelectFolder={handleSelectFolder}
        onToggleTheme={() => dispatch({ type: 'TOGGLE_THEME' })}
        onLogout={() => { logout().catch(console.error); }}
      />

      {/* Resizable pane grid */}
      <PaneGrid
        grid={grid}
        renderPane={(paneId) => {
          if (paneId === 'list') {
            return (
              <MailList
                folder={folder}
                messages={state.messages}
                loading={state.loading}
                myEmail={myEmail}
                selectedThreadId={selectedThreadId}
                page={state.currentPage}
                totalPages={totalPages}
                onSelectMessage={handleSelectMessage}
                onPageChange={handlePageChange}
                onCompose={handleNewCompose}
              />
            );
          }
          if (paneId === 'display') {
            return (
              <MailDisplay
                message={state.selectedMessage}
                thread={state.threadMessages}
                loading={state.loadingMessage}
                theme={state.theme}
                myEmail={myEmail}
                threadHasUnread={threadHasUnread}
                onClose={handleCloseMessage}
                onReply={handleReply}
                onReplyMessage={handleReplyMessage}
                onForward={handleForward}
                onTrashThread={handleTrashThread}
                onArchiveThread={handleArchiveThread}
                onFlagThread={handleFlagThread}
                onToggleRead={handleToggleRead}
                onTrashMessage={handleTrashMessage}
                onLoadMessageBody={handleLoadMessageBody}
                onDownloadAttachment={handleDownloadAttachment}
              />
            );
          }
          if (paneId === 'compose' && state.compose) {
            return (
              <ComposePane
                draft={state.compose}
                onClose={handleCloseCompose}
                onSend={handleSend}
              />
            );
          }
          return null;
        }}
      />
    </div>
  );
}
