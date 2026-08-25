/**
 * nav-sidebar.tsx — macOS-dock style folder navigation.
 *
 * Always icon-only with tiny labels. Mailbox counts, the current folder,
 * the theme and the session all arrive through props.
 */

import {
  AlertCircle,
  Archive,
  File,
  Inbox,
  LogOut,
  Moon,
  Send,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';

import type { MailboxInfo } from '@bmail/contract';

import { cn } from '../lib/cn.js';
import type { Theme } from '../types.js';

const NAV_ITEMS = [
  { folder: 'INBOX', label: 'Inbox', icon: Inbox },
  { folder: 'Drafts', label: 'Drafts', icon: File },
  { folder: 'Sent', label: 'Sent', icon: Send },
  { folder: 'Junk', label: 'Junk', icon: AlertCircle },
  { folder: 'Trash', label: 'Trash', icon: Trash2 },
  { folder: 'Archive', label: 'Archive', icon: Archive },
] as const;

interface NavSidebarProps {
  mailboxes: MailboxInfo[];
  currentFolder: string;
  theme: Theme;
  /** Logged-in address, shown in the sign-out tooltip. */
  userEmail?: string;
  onSelectFolder: (folder: string) => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}

export function NavSidebar({
  mailboxes, currentFolder, theme, userEmail,
  onSelectFolder, onToggleTheme, onLogout,
}: NavSidebarProps) {
  const unreadMap = new Map(
    mailboxes.map((mailbox) => [mailbox.path, mailbox.unseen ?? 0]),
  );

  return (
    <div
      className="flex h-full flex-col items-center border-r bg-muted/30 py-3"
      style={{ minWidth: 75, maxWidth: 75 }}
    >
      {/* Logo */}
      <div className="flex flex-col items-center gap-0.5 pb-3 mb-2 border-b border-border/40 w-full">
        <Sparkles className="h-5 w-5 text-primary" />
      </div>

      {/* Navigation */}
      <nav className="flex flex-col items-center gap-2 flex-1">
        {NAV_ITEMS.map(({ folder, label, icon: Icon }) => {
          const active = currentFolder === folder;
          const unread = unreadMap.get(folder) ?? 0;

          return (
            <button
              key={folder}
              onClick={() => onSelectFolder(folder)}
              title={label}
              className={cn(
                'group relative flex flex-col items-center justify-center rounded-lg cursor-pointer',
                'w-11 h-11 transition-all duration-200 ease-out',
                'hover:scale-110 hover:-translate-y-0.5 active:scale-95',
                active
                  ? 'bg-muted text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className={cn(
                'text-[9px] leading-none mt-0.5 font-medium',
                active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
              )}>
                {label}
              </span>
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[8px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Theme toggle + sign out */}
      <div className="mt-auto pt-2 border-t border-border/40 w-full flex flex-col items-center">
        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          className="flex flex-col items-center justify-center w-12 h-12 rounded-xl cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200 ease-out hover:scale-110 hover:-translate-y-0.5 active:scale-95"
        >
          {theme === 'dark' ? (
            <Sun className="h-[18px] w-[18px]" />
          ) : (
            <Moon className="h-[18px] w-[18px]" />
          )}
          <span className="text-[9px] leading-none mt-0.5 font-medium">
            {theme === 'dark' ? 'Light' : 'Dark'}
          </span>
        </button>

        <button
          onClick={onLogout}
          title={userEmail ? `Sign out ${userEmail}` : 'Sign out'}
          className="flex flex-col items-center justify-center w-12 h-12 rounded-xl cursor-pointer text-muted-foreground hover:bg-accent hover:text-destructive transition-all duration-200 ease-out hover:scale-110 hover:-translate-y-0.5 active:scale-95"
        >
          <LogOut className="h-[18px] w-[18px]" />
          <span className="text-[9px] leading-none mt-0.5 font-medium">Out</span>
        </button>
      </div>
    </div>
  );
}
