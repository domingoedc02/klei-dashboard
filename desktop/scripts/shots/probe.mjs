// In-page geometry/copy probe, run on both sides right before each screenshot.
// Findings -> ui-parity/geometry.json {name:{prototype:[...],desktop:[...]}}; visible copy -> ui-parity/copy.json {name:{prototype:[...],desktop:[...]}}.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT } from './common.mjs';

/** Runs in the page. Returns {issues, text}. */
function inPage() {
  const W = innerWidth, H = innerHeight;
  const CONTROLS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'SVG', 'svg']);
  const TRANSIENT = '[role=dialog],[role=menu],[role=listbox],[role=tooltip],[aria-modal=true],aside.drawer,.menu,.dlg,.hc,.drawer,.ai-head,.ai-msgs,.ai-panel,.ai-in,.search-pop,.search-note';
  const sel = (e) => {
    const c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + (c ? `.${c}` : '');
  };
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
  const ownText = (e) => own(e).map((n) => n.textContent.trim()).join(' ').replace(/\s+/g, ' ');
  const ownRect = (e) => {
    const t = own(e);
    if (!t.length) return e.getBoundingClientRect();
    const r = document.createRange();
    r.setStartBefore(t[0]); r.setEndAfter(t[t.length - 1]);
    return r.getBoundingClientRect();
  };
  const clipOf = (e, rect) => {
    let { left, top, right, bottom } = rect;
    for (let p = getComputedStyle(e).display === 'inline' ? e.parentElement : e; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      if (cs.overflowX !== 'visible') { left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
      if (cs.overflowY !== 'visible') { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom); }
    }
    return { left, top, right, bottom, empty: right - left < 1 || bottom - top < 1 };
  };
  const shown = (e, r) => {
    if (r.width < 3 || r.height < 3) return false;
    for (let p = e; p && p.nodeType === 1; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    }
    return true;
  };

  const stuck = (e) => { for (let p = e; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).position === 'sticky') return true; return false; };
  const scrollBox = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1) return p; return null; };
  const leaves = [];
  for (const e of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'OPTION', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'G', 'DEFS', 'USE'].includes(e.tagName.toUpperCase()) || e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue;
    const text = ownText(e);
    const isCtl = CONTROLS.has(e.tagName) || e.getAttribute('role') === 'img';
    if (!text && !isCtl) continue;
    const r = isCtl && !text ? e.getBoundingClientRect() : ownRect(e);
    if (!shown(e, r) || e.matches('.skip-link') || (e.clientWidth <= 1 && e.clientHeight <= 1 && getComputedStyle(e).position === 'absolute')) continue; // skip-link + .sr-only are intentionally hidden
    leaves.push({ e, r, text, ctl: isCtl && !text, clip: clipOf(e, r) });
  }

  const issues = [];
  const add = (kind, a, detail, b) => issues.push({ kind, sel: sel(a.e ?? a), text: (a.text ?? ownText(a)).slice(0, 40), ...(b ? { with: sel(b.e ?? b), withText: (b.text ?? ownText(b)).slice(0, 40) } : {}), detail });

  if (document.documentElement.scrollWidth > W + 1) issues.push({ kind: 'page-h-scroll', sel: 'html', text: '', detail: `scrollWidth ${document.documentElement.scrollWidth} > ${W}` });

  // Visible = not clipped away by a scroll/hidden ancestor.
  const vis = leaves.filter((l) => !l.clip.empty);

  for (const l of vis) {
    if (l.clip.right > W + 1 || l.clip.left < -1) add('offscreen-x', l, `x ${Math.round(l.clip.left)}..${Math.round(l.clip.right)} vs ${W}`);
    if (l.text) {
      const cs = getComputedStyle(l.e);
      const hx = l.e.scrollWidth > l.e.clientWidth + 1 && cs.overflowX !== 'visible' && cs.display !== 'inline';
      const hy = l.e.scrollHeight > l.e.clientHeight + 1 && cs.overflowY !== 'visible' && cs.display !== 'inline';
      if (hx || hy) add(cs.textOverflow === 'ellipsis' ? 'text-ellipsis' : 'text-clipped', l, `scroll ${l.e.scrollWidth}x${l.e.scrollHeight} > client ${l.e.clientWidth}x${l.e.clientHeight}`);
    }
  }

  // Overlap: two visible leaves, neither containing the other, intersecting meaningfully.
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j];
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      if (!a.text || !b.text) continue; // text-vs-text only; badges on photos and icons in fields overlap by design
      if (a.e.closest(TRANSIENT) !== b.e.closest(TRANSIENT)) continue; // popups/dialogs sit above the page by design
      // content below the fold of a pane that can still scroll, seen through a sticky bar, is not an overlap (the `covered` rule below keeps the same exemption)
      const bar = [a, b].find((x) => stuck(x.e)), under = bar && (bar === a ? b : a);
      if (bar && under && !stuck(under.e) && under.r.top >= bar.r.top - 1) { const sc = scrollBox(bar.e); if (sc && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1) continue; }
      const sa = scrollBox(a.e), sb = scrollBox(b.e);
      if (sa !== sb && (sa ? !sa.contains(b.e) : true) && (sb ? !sb.contains(a.e) : true) && (sa || sb)) continue; // content scrolled under a bar of an inner scroller
      const w = Math.min(a.clip.right, b.clip.right) - Math.max(a.clip.left, b.clip.left);
      const h = Math.min(a.clip.bottom, b.clip.bottom) - Math.max(a.clip.top, b.clip.top);
      if (w < 3 || h < 3) continue;
      const small = Math.min((a.clip.right - a.clip.left) * (a.clip.bottom - a.clip.top), (b.clip.right - b.clip.left) * (b.clip.bottom - b.clip.top));
      if (w * h < 0.2 * small) continue;
      add('overlap', a, `${Math.round(w)}x${Math.round(h)}px at (${Math.round(Math.max(a.clip.left, b.clip.left))},${Math.round(Math.max(a.clip.top, b.clip.top))})`, b);
    }
  }

  // Cover: a visible leaf in the viewport whose centre point is painted by something that is not it, not an ancestor, not a transient overlay.
  for (const l of vis) {
    if (!l.text || l.clip.top >= H || l.clip.bottom <= 0) continue;
    if (l.e.closest(TRANSIENT)) continue;
    // content merely below the fold of a scroller that can still scroll is not "covered", only text stuck under a bar at the end of scroll is
    let sc = l.e.parentElement; while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
    const scroller = sc ?? document.scrollingElement;
    if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1 && (l.clip.bottom > H - 140)) continue;
    const x = Math.min(Math.max((l.clip.left + l.clip.right) / 2, 0), W - 1), y = Math.min(Math.max((l.clip.top + l.clip.bottom) / 2, 0), H - 1);
    const top = document.elementFromPoint(x, y);
    if (!top || l.e.contains(top) || top.contains(l.e) || top.closest(TRANSIENT)) continue;
    const tr = top.getBoundingClientRect();
    if (top.tagName === 'A' && (getComputedStyle(top, '::after').position === 'absolute' || (tr.left <= l.clip.left + 1 && tr.right >= l.clip.right - 1 && tr.top <= l.clip.top + 1 && tr.bottom >= l.clip.bottom - 1))) continue; // stretched card link (::after cover or anchor wrapping the text)
    if (tr.width >= W - 1 && tr.height >= H - 1) continue; // full-viewport scrim
    add('covered', l, `painted over by ${sel(top)}${ownText(top) ? ` "${ownText(top).slice(0, 30)}"` : ''}`);
  }

  // Dialog must fit the viewport.
  for (const d of document.querySelectorAll('[role=dialog],[aria-modal=true],.dlg')) {
    const r = d.getBoundingClientRect();
    if (r.width < 3) continue;
    if (d.scrollHeight > d.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(d).overflowY)) issues.push({ kind: 'dialog-scroll', sel: sel(d), text: '', detail: `content ${d.scrollHeight}px > box ${d.clientHeight}px, footer/controls need an inner scroll` });
    if (r.height > H + 1 || r.bottom > H + 1 || r.top < -1 || r.right > W + 1 || r.left < -1) issues.push({ kind: 'dialog-overflow', sel: sel(d), text: '', detail: `rect ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} vs viewport ${W}x${H}` });
  }

  // Glued text: adjacent nodes with no whitespace between ("New inquiry" + "When a client..."). Reads as one run in the accessible name, copy, and when inline.
  for (const p of document.body.querySelectorAll('*')) {
    if (p.closest('svg') || ['SCRIPT', 'STYLE'].includes(p.tagName)) continue;
    const k = [...p.childNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
    for (let i = 0; i + 1 < k.length; i++) {
      const [x, y] = [k[i], k[i + 1]];
      const flat = (n) => n.nodeType === 3 || [n, ...n.querySelectorAll('*')].every((q) => getComputedStyle(q).display.startsWith('inline') || getComputedStyle(q).display === 'contents');
      if (!flat(x) || !flat(y) || x.tagName === 'BUTTON' || y.tagName === 'BUTTON') continue; // containers stack; only runs of inline text can read as one word
      const [tx, ty] = [x.textContent, y.textContent];
      if (!tx.trim() || !ty.trim() || /\s$/.test(tx) || /^\s/.test(ty) || !/[a-z0-9.,;:)]$/.test(tx) || !/^[A-Z]/.test(ty)) continue;
      const r = (n) => n.nodeType === 1 ? n.getBoundingClientRect() : (() => { const g = document.createRange(); g.selectNode(n); return g.getBoundingClientRect(); })();
      const [rx, ry] = [r(x), r(y)];
      if (rx.width < 3 || ry.width < 3 || Math.abs(ry.left - rx.right) > 1.5 || Math.min(rx.bottom, ry.bottom) - Math.max(rx.top, ry.top) < 3) continue; // only when they actually sit on one line, touching
      issues.push({ kind: 'glued-text', sel: sel(p), text: `${tx.trim().slice(-25)}|${ty.trim().slice(0, 25)}`, detail: 'no whitespace between nodes; accessible name / copied text runs together' });
    }
  }

  const text = leaves.map((l) => l.text || (l.e.tagName === 'INPUT' || l.e.tagName === 'TEXTAREA' ? `[${l.e.value || l.e.placeholder || l.e.type}]` : '')).filter(Boolean);
  return { issues, text };
}

export const probe = (page) => page.evaluate(inPage);

const store = { geometry: {}, copy: {} };
export function record(side, name, res) {
  (store.geometry[name] ??= {})[side] = res.issues;
  (store.copy[name] ??= {})[side] = res.text;
}

/** Merge into the existing files so a --only run keeps the other shots. */
export async function flush() {
  for (const [file, fresh] of Object.entries({ 'geometry.json': store.geometry, 'copy.json': store.copy })) {
    const p = join(OUT, file);
    const old = await readFile(p, 'utf8').then(JSON.parse, () => ({}));
    for (const [n, sides] of Object.entries(fresh)) old[n] = { ...old[n], ...sides };
    await writeFile(p, JSON.stringify(old, null, 1));
  }
}
