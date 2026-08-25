/**
 * auth.tsx — Session auth context over the BmailClient SDK.
 *
 * On mount, resolves the current user via client.me(). Gates the app:
 * router.tsx redirects to /login while there is no user.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import type { AuthUser } from '@bmail/contract';

import { client } from './lib/client.js';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    client.me()
      .then((sessionUser) => {
        if (alive) setUser(sessionUser);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const loggedIn = await client.login(email, password);
    setUser(loggedIn);
  };

  const logout = async () => {
    await client.logout();
    setUser(null);
    window.location.href = '/login';
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
