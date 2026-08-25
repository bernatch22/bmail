/**
 * store.tsx — App-wide state: useReducer + Context.
 *
 * Holds mailboxes, the current folder page, the selected conversation and
 * the compose draft. UI components never read this directly — the pages
 * translate it into props for @bmail/react.
 */

import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';

import type { FullMessage, MailboxInfo, MessageEnvelope } from '@bmail/core/types';
import type { ComposeDraft, Theme } from '@bmail/react';

// ─── State shape ───────────────────────────────────────

export interface AppState {
  mailboxes: MailboxInfo[];
  messages: MessageEnvelope[];
  currentFolder: string;
  currentPage: number;
  totalMessages: number;
  pageSize: number;
  selectedMessage: FullMessage | null;
  selectedUid: number | null;
  threadMessages: FullMessage[];
  loading: boolean;
  loadingMessage: boolean;
  theme: Theme;
  wsConnected: boolean;
  accountLabel: string;
  accountUser: string;
  compose: ComposeDraft | null;
}

export type Action =
  | { type: 'SET_MAILBOXES'; payload: MailboxInfo[] }
  | { type: 'SET_MESSAGES'; payload: { messages: MessageEnvelope[]; total: number; page: number } }
  | { type: 'SELECT_FOLDER'; payload: string }
  | { type: 'SELECT_MESSAGE'; payload: FullMessage }
  | { type: 'SET_THREAD'; payload: FullMessage[] }
  | { type: 'SET_THREAD_MESSAGE'; payload: FullMessage }
  | { type: 'CLEAR_MESSAGE' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_LOADING_MESSAGE'; payload: boolean }
  | { type: 'SET_THEME'; payload: Theme }
  | { type: 'TOGGLE_THEME' }
  | { type: 'SET_WS_CONNECTED'; payload: boolean }
  | { type: 'SET_ACCOUNT'; payload: { label: string; user: string } }
  | { type: 'MARK_READ'; payload: { folder: string; uid: number } }
  | { type: 'START_COMPOSE'; payload: ComposeDraft }
  | { type: 'CLOSE_COMPOSE' };

// ─── Initial state ─────────────────────────────────────

const THEME_STORAGE_KEY = 'bmail-theme';

function loadInitialTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_STORAGE_KEY) ?? 'light') as Theme;
  } catch {
    return 'light';
  }
}

export const INITIAL_STATE: AppState = {
  mailboxes: [],
  messages: [],
  currentFolder: 'INBOX',
  currentPage: 1,
  totalMessages: 0,
  pageSize: 30,
  selectedMessage: null,
  selectedUid: null,
  threadMessages: [],
  loading: false,
  loadingMessage: false,
  theme: loadInitialTheme(),
  wsConnected: false,
  accountLabel: '',
  accountUser: '',
  compose: null,
};

// ─── Reducer ───────────────────────────────────────────

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_MAILBOXES':
      return { ...state, mailboxes: action.payload };

    case 'SET_MESSAGES':
      return {
        ...state,
        messages: action.payload.messages,
        totalMessages: action.payload.total,
        currentPage: action.payload.page,
        loading: false,
      };

    case 'SELECT_FOLDER':
      return { ...state, currentFolder: action.payload, currentPage: 1, selectedMessage: null, selectedUid: null };

    case 'SELECT_MESSAGE':
      return { ...state, selectedMessage: action.payload, selectedUid: action.payload.uid, loadingMessage: false };

    case 'SET_THREAD':
      return { ...state, threadMessages: action.payload, loadingMessage: false };

    case 'SET_THREAD_MESSAGE': {
      const updated = state.threadMessages.map((message) =>
        message.uid === action.payload.uid ? action.payload : message,
      );
      return { ...state, threadMessages: updated };
    }

    case 'CLEAR_MESSAGE':
      return { ...state, selectedMessage: null, selectedUid: null, threadMessages: [] };

    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_LOADING_MESSAGE':
      return { ...state, loadingMessage: action.payload };

    case 'SET_THEME':
      localStorage.setItem(THEME_STORAGE_KEY, action.payload);
      return { ...state, theme: action.payload };

    case 'TOGGLE_THEME': {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_STORAGE_KEY, next);
      return { ...state, theme: next };
    }

    case 'SET_WS_CONNECTED':
      return { ...state, wsConnected: action.payload };

    case 'SET_ACCOUNT':
      return { ...state, accountLabel: action.payload.label, accountUser: action.payload.user };

    case 'MARK_READ': {
      // Update message in list to seen
      const messages = state.messages.map((message) =>
        message.uid === action.payload.uid ? { ...message, seen: true } : message,
      );
      // Decrement unseen count for folder
      const mailboxes = state.mailboxes.map((mailbox) =>
        mailbox.path === action.payload.folder && mailbox.unseen > 0
          ? { ...mailbox, unseen: mailbox.unseen - 1 }
          : mailbox,
      );
      return { ...state, messages, mailboxes };
    }

    case 'START_COMPOSE':
      return { ...state, compose: action.payload };

    case 'CLOSE_COMPOSE':
      return { ...state, compose: null };

    default:
      return state;
  }
}

// ─── Context ───────────────────────────────────────────

const StoreContext = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore(): { state: AppState; dispatch: Dispatch<Action> } {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
}
