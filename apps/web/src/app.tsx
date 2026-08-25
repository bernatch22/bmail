/**
 * app.tsx — App root: initial load and the realtime channel.
 *
 * Init only: account, mailboxes, the folder from the URL (plus a deep-linked
 * message when the URL carries a uid). All subsequent navigation happens in
 * the MailPage handlers. The WebSocket rides on BmailSocket from the SDK.
 */

import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';

import type { WsEvent } from '@bmail/contract';
import { slugToFolder } from '@bmail/domain';
import type { BmailSocket } from '@bmail/client';

import { useAuth } from './auth.js';
import { client, deriveWsUrl } from './lib/client.js';
import { MailPage } from './pages/mail.js';
import { useStore } from './store.js';

export default function App() {
  const { state, dispatch } = useStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { folder: folderSlug, uid } = useParams<{ folder?: string; uid?: string }>();

  const imapFolder = slugToFolder(folderSlug ?? 'inbox');

  // ─── Initial load (runs once) ────────────────────────

  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const init = async () => {
      try {
        dispatch({
          type: 'SET_ACCOUNT',
          payload: { label: user?.org ?? '', user: user?.email ?? '' },
        });

        const mailboxes = await client.listMailboxes();
        dispatch({ type: 'SET_MAILBOXES', payload: mailboxes });

        // Load the folder from URL
        dispatch({ type: 'SELECT_FOLDER', payload: imapFolder });
        dispatch({ type: 'SET_LOADING', payload: true });
        const result = await client.listMessages(imapFolder, { page: 1, limit: state.pageSize });
        dispatch({
          type: 'SET_MESSAGES',
          payload: { messages: result.data, total: result.total, page: 1 },
        });

        // Deep-link: if URL has a uid, load that message + thread
        if (uid) {
          dispatch({ type: 'SET_LOADING_MESSAGE', payload: true });
          const message = await client.getMessage(imapFolder, Number(uid));
          dispatch({ type: 'SELECT_MESSAGE', payload: message });

          const threadId = message.threadId || message.subject;
          const thread = await client.getThread(threadId);
          dispatch({ type: 'SET_THREAD', payload: thread });
        }
      } catch (err: unknown) {
        console.error('Failed to init:', err instanceof Error ? err.message : err);
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Realtime channel ────────────────────────────────

  // Keep a ref to current state for use in WS callbacks (avoids stale closures)
  const stateRef = useRef(state);
  stateRef.current = state;

  const socketRef = useRef<BmailSocket | null>(null);

  useEffect(() => {
    if (socketRef.current) return;

    const socket = client.connect(deriveWsUrl());
    socketRef.current = socket;

    socket.subscribe(async (event: WsEvent) => {
      if (event.type === 'connected') {
        dispatch({ type: 'SET_WS_CONNECTED', payload: true });
      }

      // Sync engine push — refresh mailboxes and current folder messages
      if (event.type === 'sync_update') {
        const mailboxes = event.payload.mailboxes;
        if (mailboxes) {
          dispatch({ type: 'SET_MAILBOXES', payload: mailboxes as never });
        }
        // Always fetch fresh messages for current folder (cross-folder thread changes)
        try {
          const current = stateRef.current;
          const result = await client.listMessages(current.currentFolder, {
            page: current.currentPage,
            limit: current.pageSize,
          });
          dispatch({
            type: 'SET_MESSAGES',
            payload: { messages: result.data, total: result.total, page: current.currentPage },
          });
        } catch { /* ignore */ }
      }

      // IMAP IDLE (INBOX only) — fetch from API since no data in event
      if (event.type === 'new_message') {
        try {
          const current = stateRef.current;
          const mailboxes = await client.listMailboxes();
          dispatch({ type: 'SET_MAILBOXES', payload: mailboxes });
          const result = await client.listMessages(current.currentFolder, {
            page: current.currentPage,
            limit: current.pageSize,
          });
          dispatch({
            type: 'SET_MESSAGES',
            payload: { messages: result.data, total: result.total, page: current.currentPage },
          });
        } catch { /* ignore */ }
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Theme ───────────────────────────────────────────

  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state.theme]);

  return <MailPage navigate={navigate} />;
}
