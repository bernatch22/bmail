/**
 * compose-pane.tsx — Reply/forward/new-mail composer.
 *
 * Presentation + local field state only. The Gmail-style quoted body is
 * built with @bmail/domain (single source of the quote/forward HTML), and
 * Send hands the app a ComposeSubmission: final HTML/text plus the picked
 * File objects — base64 encoding and the API call happen in the app layer.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Forward, Loader2, Mail, Paperclip, Reply, Send, X } from 'lucide-react';

import { buildForwardBody, buildQuotedBody } from '@bmail/domain';

import { Button } from '../primitives/button.js';
import { formatFileSize } from '../lib/format.js';
import type { ComposeDraft, ComposeSubmission } from '../types.js';

interface ComposePaneProps {
  draft: ComposeDraft;
  onClose: () => void;
  /** Perform the actual send; rejects with an Error to surface a message. */
  onSend: (submission: ComposeSubmission) => Promise<void>;
}

export function ComposePane({ draft, onClose, onSend }: ComposePaneProps) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset the fields whenever a new draft opens.
  useEffect(() => {
    setTo(draft.to);
    setCc(draft.cc);
    setSubject(draft.subject);
    setBody(draft.body);
    setFiles([]);
    setShowCc(Boolean(draft.cc));
    setSending(false);
    setError(null);
    setSent(false);
    setTimeout(() => bodyRef.current?.focus(), 100);
  }, [draft]);

  const ModeIcon = draft.mode === 'reply' ? Reply
    : draft.mode === 'forward' ? Forward
    : Mail;
  const modeLabel = draft.mode === 'reply' ? 'Reply'
    : draft.mode === 'forward' ? 'Forward'
    : 'New Message';
  const modeColor = draft.mode === 'reply'
    ? 'text-blue-500 bg-blue-500/10'
    : draft.mode === 'forward'
    ? 'text-amber-500 bg-amber-500/10'
    : 'text-emerald-500 bg-emerald-500/10';

  // ─── Attachments ─────────────────────────────────────

  const handlePickFiles = (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setFiles((previous) => [...previous, ...Array.from(picked)]);
  };

  const handleRemoveFile = (index: number) => {
    setFiles((previous) => previous.filter((_, i) => i !== index));
  };

  // ─── Send ────────────────────────────────────────────

  const handleSend = async () => {
    if (!to.trim()) {
      setError('Recipient is required');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const replyBody = body ? `<div dir="ltr">${body.replace(/\n/g, '<br>')}</div>` : '';

      // Quote the original below the new text, Gmail-style (domain logic).
      let fullHtml = replyBody;
      if (draft.quotedHtml && draft.source && (draft.mode === 'reply' || draft.mode === 'forward')) {
        const quoteSource = {
          from: draft.source.from,
          date: draft.source.date,
          subject: draft.source.subject,
          html: draft.quotedHtml,
        };

        fullHtml = draft.mode === 'forward'
          ? buildForwardBody(replyBody, quoteSource, to)
          : buildQuotedBody(replyBody, quoteSource);
      }

      await onSend({
        to: to.trim(),
        cc: cc.trim() || undefined,
        subject: subject.trim() || '(no subject)',
        html: fullHtml || undefined,
        text: body || undefined,
        threadId: draft.source?.threadId,
        inReplyTo: draft.mode === 'reply' ? draft.inReplyTo : undefined,
        files,
      });

      setSent(true);
      setTimeout(onClose, 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Send failed');
      setSending(false);
    }
  };

  // Sent success state
  if (sent) {
    return (
      <div className="flex h-full flex-col items-center justify-center min-w-0 overflow-hidden border-l bg-background">
        <div className="flex flex-col items-center gap-3 animate-in fade-in zoom-in-95 duration-300">
          <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Send className="h-5 w-5 text-emerald-500" />
          </div>
          <span className="text-sm font-medium text-foreground">Message sent</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col min-w-0 overflow-hidden border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <div className={`h-7 w-7 rounded-md flex items-center justify-center ${modeColor}`}>
          <ModeIcon className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-sm font-semibold text-foreground flex-1">{modeLabel}</h3>
        <button
          onClick={onClose}
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs border border-destructive/20">
          {error}
        </div>
      )}

      {/* Fields */}
      <div className="flex flex-col border-b">
        {/* To */}
        <div className="flex items-center px-5 py-2.5 gap-3 border-b border-border/30">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-10 shrink-0">To</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="recipient@email.com"
          />
          {!showCc && (
            <button
              onClick={() => setShowCc(true)}
              className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors flex items-center gap-0.5"
            >
              Cc <ChevronDown className="h-2.5 w-2.5" />
            </button>
          )}
        </div>

        {/* Cc */}
        {showCc && (
          <div className="flex items-center px-5 py-2.5 gap-3 border-b border-border/30">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-10 shrink-0">Cc</span>
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
              placeholder="cc@email.com"
            />
          </div>
        )}

        {/* Subject */}
        <div className="flex items-center px-5 py-2.5 gap-3">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-10 shrink-0">Subj</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="Subject"
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="h-full w-full resize-none bg-transparent px-5 py-4 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 leading-relaxed"
          placeholder="Write your message..."
        />
      </div>

      {/* Picked attachments */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t px-5 py-2.5">
          {files.map((file, index) => (
            <span
              key={`${file.name}:${index}`}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-xs text-foreground"
            >
              <Paperclip className="h-3 w-3 text-muted-foreground" />
              <span className="max-w-[160px] truncate">{file.name}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {formatFileSize(file.size)}
              </span>
              <button
                onClick={() => handleRemoveFile(index)}
                title={`Remove ${file.name}`}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 border-t px-5 py-3 bg-muted/20">
        <Button
          size="sm"
          onClick={handleSend}
          disabled={sending || !to.trim()}
          className="gap-2 rounded-lg px-5 shadow-sm"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {sending ? 'Sending...' : 'Send'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handlePickFiles(e.target.files);
            // Reset so picking the same file twice fires onChange again.
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
          className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <button
          onClick={onClose}
          className="ml-auto text-xs text-muted-foreground/60 hover:text-destructive transition-colors"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
