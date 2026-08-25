/**
 * message-body.tsx — Renders one message's body.
 *
 * HTML bodies render inside a sandboxed iframe: scripts are stripped, the
 * collapse script (lib/quotes) hides quoted tails, and in dark theme the
 * darkify pass recolors the document. Plain-text bodies render as markdown
 * with the quoted tail behind a "•••" toggle.
 *
 * Attachment chips render below the body when the message carries any.
 */

import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';

import type { AttachmentInfo, FullMessage } from '@bmail/core/types';

import { buildCollapseScript, stripTextQuotes } from '../lib/quotes.js';
import type { Theme } from '../types.js';
import { AttachmentChips } from './attachment-chips.js';

marked.setOptions({ breaks: true, gfm: true });

interface MessageBodyProps {
  message: FullMessage;
  theme: Theme;
  onDownloadAttachment?: (message: FullMessage, attachment: AttachmentInfo) => void;
}

export function MessageBody({ message, theme, onDownloadAttachment }: MessageBodyProps) {
  const hasHtml = Boolean(message.htmlBody);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);

  useEffect(() => {
    setIframeLoaded(false);
    setShowQuoted(false);
  }, [message.uid, theme]);

  // Full srcDoc for the iframe: sanitized HTML + collapse script + base style.
  const iframeSrc = useMemo(() => {
    if (!message.htmlBody) return '';

    const cleaned = message.htmlBody.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    const script = buildCollapseScript();
    const bg = theme === 'dark' ? '#1a1a1a' : '#fff';
    const fg = theme === 'dark' ? '#d4d4d8' : '#3f3f46';

    // Every link opens in a new tab: the iframe is sandboxed, so in-place
    // navigation would be blocked anyway — <base target="_blank"> plus the
    // allow-popups sandbox flags below is what makes links clickable at all.
    return '<!DOCTYPE html><html><head><meta charset="utf-8">'
      + '<base target="_blank">'
      + '<style>'
      + 'html,body{margin:0;background:' + bg + '}'
      + 'body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;padding:20px;color:' + fg + ';box-sizing:border-box}'
      + 'a{color:#2563eb}img{max-width:100%;height:auto}'
      + '</style></head><body>' + cleaned + script + '</body></html>';
  }, [message.htmlBody, theme]);

  // Plain-text path: markdown-render the fresh body and the quoted tail.
  const { bodyHtml, hasQuoted, quotedHtml } = useMemo(() => {
    if (hasHtml || !message.textBody) {
      return { bodyHtml: '', hasQuoted: false, quotedHtml: '' };
    }

    const { body, quoted } = stripTextQuotes(message.textBody);
    const clean = (text: string) => text
      .replace(/\[https?:\/\/[^\]]*\]/g, '')
      .replace(/https?:\/\/\S{80,}/g, '[link]')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      bodyHtml: marked.parse(clean(body)) as string,
      hasQuoted: Boolean(quoted),
      quotedHtml: quoted ? marked.parse(clean(quoted)) as string : '',
    };
  }, [hasHtml, message.textBody]);

  const handleIframeLoad = (event: React.SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = event.currentTarget;
    const doc = iframe.contentDocument;
    if (!doc?.body) return;

    const resizeIframe = () => {
      const height = doc.body.scrollHeight;
      if (height > 0) iframe.style.height = height + 'px';
    };

    if (theme === 'dark') {
      import('../lib/darkify.js').then(({ darkifyDocument }) => {
        darkifyDocument(doc);
        resizeIframe();
      });
    }
    resizeIframe();

    // Watch for content changes (collapse script, image loads, etc.)
    const observer = new MutationObserver(() => resizeIframe());
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true });

    // Also resize on image loads
    doc.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', resizeIframe);
    });

    setIframeLoaded(true);
  };

  const attachments = message.attachments ?? [];
  const chips = (
    <AttachmentChips
      attachments={attachments}
      onDownload={(attachment) => onDownloadAttachment?.(message, attachment)}
    />
  );

  if (hasHtml) {
    return (
      <div className="relative">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10" style={{ minHeight: '200px' }}>
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
        <iframe
          srcDoc={iframeSrc}
          sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
          onLoad={handleIframeLoad}
          className="w-full border-0"
          style={{
            minHeight: '60px',
            opacity: iframeLoaded ? 1 : 0,
            transition: 'opacity 0.2s ease',
            overflow: 'hidden',
            background: theme === 'dark' ? '#1a1a1a' : '#ffffff',
          }}
          title="Email content"
        />
        {chips}
      </div>
    );
  }

  return (
    <div>
      <div className="px-6 py-4">
        <div className="prose-mail max-w-none text-sm text-foreground" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        {hasQuoted && (
          <>
            <button
              onClick={() => setShowQuoted(!showQuoted)}
              className="mt-2 px-3 py-0.5 rounded border border-border/40 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-colors tracking-widest"
            >
              {showQuoted ? '▲' : '•••'}
            </button>
            {showQuoted && (
              <div className="mt-2 pl-3 border-l-2 border-muted text-muted-foreground/70 prose-mail max-w-none text-sm" dangerouslySetInnerHTML={{ __html: quotedHtml }} />
            )}
          </>
        )}
      </div>
      {chips}
    </div>
  );
}
