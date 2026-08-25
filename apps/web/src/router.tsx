/**
 * router.tsx — Auth-gated routes.
 *
 * /login is public; everything else requires a session. Folder slug ↔ IMAP
 * path mapping lives in @bmail/domain (folders.ts), not here.
 */

import { createBrowserRouter, Navigate, Outlet } from 'react-router';

import { TooltipProvider } from '@bmail/ui';

import App from './app.js';
import { AuthProvider, useAuth } from './auth.js';
import Login from './pages/login.js';
import { StoreProvider } from './store.js';

function RootLayout() {
  return (
    <AuthProvider>
      <StoreProvider>
        <TooltipProvider delayDuration={200}>
          <Outlet />
        </TooltipProvider>
      </StoreProvider>
    </AuthProvider>
  );
}

function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/login', element: <Login /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <Navigate to="/inbox" replace /> },
          { path: '/:folder', element: <App /> },
          { path: '/:folder/:uid', element: <App /> },
        ],
      },
    ],
  },
]);
