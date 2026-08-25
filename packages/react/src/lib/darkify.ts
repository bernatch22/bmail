/**
 * darkify.ts — Intelligent dark-mode transformation for email HTML.
 *
 * Walks the DOM of an iframe's contentDocument and transforms colors:
 *  - Light backgrounds → dark variant preserving hue
 *  - Dark text on light bg → light text
 *  - Preserves colorful elements (buttons, badges, colored links)
 *  - Leaves images/media untouched
 */

const DARK_BG = '#191B20';
const DARK_TEXT = '#d4d4d8';
const DARK_LINK = '#60a5fa';

interface HSL { h: number; s: number; l: number; a: number; }

function parseColor(raw: string): HSL | null {
  const el = document.createElement('div');
  el.style.color = raw;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);

  const rgba = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!rgba) return null;
  const r = +rgba[1] / 255, g = +rgba[2] / 255, b = +rgba[3] / 255;
  const a = rgba[4] !== undefined ? +rgba[4] : 1;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100, a };
}

function hslToStr(c: HSL): string {
  if (c.a < 1) return `hsla(${c.h.toFixed(0)}, ${c.s.toFixed(0)}%, ${c.l.toFixed(0)}%, ${c.a})`;
  return `hsl(${c.h.toFixed(0)}, ${c.s.toFixed(0)}%, ${c.l.toFixed(0)}%)`;
}

function isLight(c: HSL): boolean { return c.l > 60; }
function isDark(c: HSL): boolean { return c.l < 30; }
function isWhitish(c: HSL): boolean { return c.l > 85 && c.s < 15; }
function isBlackish(c: HSL): boolean { return c.l < 15 && c.s < 15; }

/** Has enough saturation to be considered "colorful" (not gray/white/black) */
function isColorful(c: HSL): boolean { return c.s > 25 && c.l > 15 && c.l < 85; }

/** Transform a background color for dark mode */
function transformBg(c: HSL): HSL {
  // Near-white → our dark bg
  if (isWhitish(c)) return { ...c, h: 220, s: 12, l: 11, a: c.a }; // ≈ #191B20
  // Light but slightly colored (like pale grays, light blues)
  if (isLight(c)) return { h: c.h, s: Math.min(c.s, 20), l: Math.max(8, 100 - c.l * 0.9), a: c.a };
  // Already dark — keep it
  return c;
}

/** Transform a text/foreground color for dark mode */
function transformFg(c: HSL): HSL {
  // Near-black text → light gray
  if (isBlackish(c)) return { ...c, h: 0, s: 0, l: 83, a: c.a }; // ≈ #d4d4d8
  // Dark text → lighten
  if (isDark(c)) return { h: c.h, s: c.s, l: Math.min(85, 100 - c.l * 0.8), a: c.a };
  // Colorful text (links, etc.) — lighten slightly but keep hue
  if (isColorful(c) && c.l < 50) return { h: c.h, s: c.s, l: Math.min(70, c.l + 25), a: c.a };
  return c;
}

const SKIP_TAGS = new Set(['IMG', 'VIDEO', 'PICTURE', 'SVG', 'CANVAS', 'IFRAME', 'SOURCE']);

/**
 * Apply intelligent dark-mode transformation to an iframe's document.
 * Call this from the parent window after iframe load.
 */
export function darkifyDocument(doc: Document): void {
  // Set base
  doc.documentElement.style.background = DARK_BG;
  doc.body.style.background = DARK_BG;
  doc.body.style.color = DARK_TEXT;

  // Walk all elements
  const all = doc.body.querySelectorAll('*');
  for (const el of all) {
    if (SKIP_TAGS.has(el.tagName)) continue;

    const style = doc.defaultView?.getComputedStyle(el);
    if (!style) continue;
    const htmlEl = el as HTMLElement;

    // Transform background
    const bgRaw = style.backgroundColor;
    if (bgRaw && bgRaw !== 'rgba(0, 0, 0, 0)' && bgRaw !== 'transparent') {
      const bg = parseColor(bgRaw);
      if (bg && bg.a > 0.1) {
        // Skip colorful backgrounds (buttons, badges, etc.) — they look intentional
        if (isColorful(bg) && bg.l < 70 && bg.l > 20) {
          // Colorful bg — keep it, but ensure text contrast
          const fgC = parseColor(style.color);
          if (fgC && fgC.l < 60) {
            htmlEl.style.color = '#fff';
          }
        } else {
          const darkBg = transformBg(bg);
          htmlEl.style.backgroundColor = hslToStr(darkBg);
        }
      }
    }

    // Transform text color
    const fgRaw = style.color;
    if (fgRaw) {
      const fg = parseColor(fgRaw);
      if (fg) {
        // Don't touch color if bg was colorful (already handled above)
        const bgCheck = parseColor(style.backgroundColor || '');
        if (bgCheck && isColorful(bgCheck) && bgCheck.l < 70 && bgCheck.l > 20) continue;

        const darkFg = transformFg(fg);
        htmlEl.style.color = hslToStr(darkFg);
      }
    }

    // Transform border colors (subtle)
    const borderColor = style.borderColor;
    if (borderColor && borderColor !== bgRaw) {
      const bc = parseColor(borderColor);
      if (bc && (isWhitish(bc) || isLight(bc)) && !isColorful(bc)) {
        htmlEl.style.borderColor = 'hsl(220, 10%, 25%)';
      }
    }
  }

  // Fix links
  const links = doc.body.querySelectorAll('a');
  for (const a of links) {
    const aStyle = doc.defaultView?.getComputedStyle(a);
    if (!aStyle) continue;
    const col = parseColor(aStyle.color);
    // If link text is dark, lighten it
    if (col && col.l < 50) {
      (a as HTMLElement).style.color = DARK_LINK;
    }
  }

  // Images: don't invert, just reduce brightness slightly to avoid glare
  const images = doc.body.querySelectorAll('img');
  for (const img of images) {
    img.style.filter = 'brightness(0.9)';
  }

  // SVGs (icons/logos): reduce brightness
  const svgs = doc.body.querySelectorAll('svg');
  for (const svg of svgs) {
    (svg as unknown as HTMLElement).style.filter = 'brightness(0.9)';
  }
}
