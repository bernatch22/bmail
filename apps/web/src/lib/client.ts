/**
 * client.ts — The app's single BmailClient instance.
 *
 * Cookie mode, same-origin: the Vite dev proxy (and nginx in production)
 * routes /api and /ws to the server. The 401 reaction — navigating to
 * /login — is an app decision, which is exactly why the SDK takes it as a
 * callback instead of hardcoding it.
 */

import { BmailClient } from '@bmail/client';

export const client = new BmailClient({
  baseUrl: '',
  authMode: 'cookie',
  onUnauthorized: () => {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  },
});

/** Same-origin WebSocket URL (an empty baseUrl cannot derive one itself). */
export function deriveWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
