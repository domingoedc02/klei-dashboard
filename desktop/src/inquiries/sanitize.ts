// The same allow-list as `HtmlSanitizer` on the backend (FR-21); both must pass docs/fixtures/xss-payloads.json.
const KEEP = new Set(['B', 'I', 'U', 'STRONG', 'EM', 'UL', 'OL', 'LI', 'A', 'BR', 'DIV']);
// Elements whose content is code or markup, never text a reader should see.
const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEXTAREA', 'SELECT', 'TITLE', 'HEAD', 'FRAMESET', 'APPLET']);
const SAFE_HREF = /^(https?:|mailto:)/i;
// Browsers ignore tabs, line breaks and spaces inside a scheme, so the test runs on the href without them.
const INVISIBLE = /[\u0000- \u007f-\u009f]/g;

function copy(from: Node, to: Node) {
  for (const n of Array.from(from.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) {
      to.appendChild(document.createTextNode(n.textContent ?? ''));
      continue;
    }
    if (!(n instanceof Element)) continue; // comments, processing instructions
    const tag = n.tagName.toUpperCase();
    if (DROP.has(tag)) continue;
    if (!KEEP.has(tag)) { copy(n, to); continue; }
    const el = document.createElement(tag.toLowerCase());
    if (tag === 'A') {
      const href = (n.getAttribute('href') ?? '').replace(INVISIBLE, '');
      if (!SAFE_HREF.test(href)) { copy(n, to); continue; }
      el.setAttribute('href', href);
      el.setAttribute('rel', 'noopener noreferrer');
    }
    copy(n, el);
    to.appendChild(el);
  }
}

/** Clean HTML for a Reply: allowed tags only, no attributes except a safe `href` on links. DOMParser never runs scripts or loads images. */
export function sanitizeHtml(html: string): string {
  const out = document.createElement('div');
  copy(new DOMParser().parseFromString(html, 'text/html').body, out);
  return out.innerHTML;
}

/** True when the HTML holds no text a Client would read. */
export function isBlank(html: string): boolean {
  const t = document.createElement('div');
  t.innerHTML = sanitizeHtml(html);
  return (t.textContent ?? '').trim() === '';
}
