/**
 * quotes.ts — Detection and collapsing of quoted content in message bodies.
 *
 * Two mechanisms, one per body kind:
 *   - Plain text: stripTextQuotes() splits new content from the quoted tail
 *     so the view can render the tail behind a "•••" toggle.
 *   - HTML: buildCollapseScript() returns a <script> injected into the
 *     rendering iframe that finds Gmail/Outlook quote blocks and hides them
 *     behind the same toggle, inside the sandboxed document.
 */

// ─── Plain-text quotes ─────────────────────────────────

const QUOTE_HEADER_RE = /^(On .+wrote:|El .+escribi[óo]:|.+ schrieb:|Le .+ a écrit :)/m;
const QUOTE_LINE_RE = /^>/;

/** Split a plain-text body into fresh content and its quoted tail. */
export function stripTextQuotes(text: string): { body: string; quoted: string } {
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (QUOTE_HEADER_RE.test(lines[i]) || QUOTE_LINE_RE.test(lines[i])) {
      return {
        body: lines.slice(0, i).join('\n').trimEnd(),
        quoted: lines.slice(i).join('\n'),
      };
    }
  }

  return { body: text, quoted: '' };
}

// ─── HTML quotes (iframe script) ───────────────────────

/**
 * Build the collapse script that runs inside the email iframe. It finds
 * gmail_quote wrappers, Outlook reply divs, top-level blockquotes and
 * "wrote:"/"escribió:" attribution lines, hides them, and inserts a "•••"
 * toggle button in their place.
 */
export function buildCollapseScript(): string {
  return [
    '<script>',
    'document.addEventListener("DOMContentLoaded", function() {',
    '  var found = [];',
    '  document.querySelectorAll(".gmail_quote, [class*=gmail_quote]").forEach(function(el) { found.push(el); });',
    '  document.querySelectorAll("#appendonsend, #divRplyFwdMsg, [id*=divRpl]").forEach(function(el) { found.push(el); });',
    '  document.querySelectorAll("body > blockquote, body > div > blockquote").forEach(function(el) { found.push(el); });',
    '  if (found.length === 0) {',
    '    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);',
    '    while (w.nextNode()) {',
    '      var t = w.currentNode.textContent || "";',
    '      if (/wrote:|escribi[óo]:|schrieb:|a .crit/i.test(t)) {',
    '        var p = w.currentNode.parentElement;',
    '        while (p && p !== document.body && p.children.length < 3) p = p.parentElement;',
    '        if (p && p !== document.body) {',
    '          found.push(p);',
    '          var s = p.nextElementSibling;',
    '          while (s) { found.push(s); s = s.nextElementSibling; }',
    '        }',
    '        break;',
    '      }',
    '    }',
    '  }',
    '  if (found.length === 0) return;',
    '  found = found.filter(function(el, i) { return found.indexOf(el) === i; });',
    '  found.forEach(function(el) { el.style.display = "none"; });',
    '  // Also hide hr elements right before quoted content',
    '  found.forEach(function(el) { var prev = el.previousElementSibling; while (prev && (prev.tagName === "HR" || prev.tagName === "BR")) { prev.style.display = "none"; prev = prev.previousElementSibling; } });',
    '  var btn = document.createElement("button");',
    '  btn.textContent = "\\u2022\\u2022\\u2022";',
    '  btn.style.cssText = "display:inline-block;margin:8px 0;padding:1px 14px;border:1px solid rgba(128,128,128,0.3);border-radius:4px;background:transparent;color:#888;font-size:11px;cursor:pointer;letter-spacing:3px;";',
    '  btn.onclick = function() {',
    '    var show = btn.textContent === "\\u2022\\u2022\\u2022";',
    '    found.forEach(function(el) { el.style.display = show ? "" : "none"; });',
    '    btn.textContent = show ? "\\u25B2" : "\\u2022\\u2022\\u2022";',
    '  };',
    '  if (found[0].parentNode) found[0].parentNode.insertBefore(btn, found[0]);',
    '});',
    '</script>',
  ].join('\n');
}
