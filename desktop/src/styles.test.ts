import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const tokens = read('../../backend/app/src/main/resources/static/tokens.css');
const styles = read('styles.css');
const tok = (name: string) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
const blocks = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].split(',').map((s) => s.trim()), body: m[2] }));

describe('tokens.css', () => {
  it('body 16px / 1.5, title 26px / 700 / -0.033em', () => {
    expect(tok('type-body-font-size')).toBe('16px');
    expect(tok('type-body-line-height')).toBe('1.5');
    expect(tok('type-title-font-size')).toBe('26px');
    expect(tok('type-title-font-weight')).toBe('700');
    expect(tok('type-title-letter-spacing')).toBe('-0.033em');
  });

  it('radii sm 4 / md 8 / lg 12 and an elevation token', () => {
    expect([tok('radius-sm'), tok('radius-md'), tok('radius-lg')]).toEqual(['4px', '8px', '12px']);
    expect(tok('elev-raised')).toMatch(/rgba\(0, 0, 0, 0\.04\) 0px 4px 18px/);
  });

  it('serves Inter 400, 500, 600 and 700 from fonts/', () => {
    for (const w of [400, 500, 600, 700]) expect(tokens).toContain(`font-weight: ${w}; font-display: swap; src: url('fonts/inter-latin-${w}.woff2')`);
  });

  it('pill palette follows the prototype', () => {
    expect([tok('color-pill-info-bg'), tok('color-pill-pos-bg'), tok('color-pill-pos-ink'), tok('color-pill-warn-bg'), tok('color-pill-warn-ink')])
      .toEqual(['#f2f9ff', '#e8faf0', '#14802a', '#fff3e8', '#b34700']);
    expect(tok('color-pill-neutral-bg')).toBe('rgba(0, 0, 0, 0.05)');
  });

  it('keeps the two accessibility deviations', () => {
    expect(tok('color-focus-ring')).toBe('#0063bf');
    expect(tok('color-faint')).toBe('#716c66');
  });
});

describe('styles.css', () => {
  it.each(['.menu', '.search-pop', '.toast', '.dialog', '.drawer'])('%s floats on --elev-raised and no other shadow', (sel) => {
    const shadows = blocks(styles).filter((b) => b.sel.includes(sel)).flatMap((b) => [...b.body.matchAll(/box-shadow:\s*([^;]+)/g)].map((m) => m[1].trim()));
    expect(shadows.length).toBeGreaterThan(0);
    expect(new Set(shadows)).toEqual(new Set(['var(--elev-raised)']));
  });

  it('pill tones map to the palette, with info', () => {
    for (const t of ['info', 'pos', 'neutral', 'warn', 'neg']) expect(styles).toContain(`.pill.${t} { background: var(--color-pill-${t}-bg); color: var(--color-pill-${t}-ink); }`);
  });

  it('skeleton shimmers, and is static under prefers-reduced-motion', () => {
    expect(blocks(styles).find((b) => b.sel.includes('.skeleton'))!.body).toMatch(/animation:\s*shimmer 1\.4s/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.skeleton \{ animation: none;/);
  });

  it('button is radius 4 / weight 600 / padding 8 16, secondary filled', () => {
    const b = blocks(styles).find((x) => x.sel.includes('.btn'))!.body;
    expect(b).toMatch(/padding: 8px var\(--space-4\)/);
    expect(b).toMatch(/border-radius: var\(--radius-sm\)/);
    expect(b).toMatch(/font-weight: 600/);
    expect(b).toMatch(/background: rgba\(0, 0, 0, 0\.05\)/);
  });

  it('shell frame follows the prototype: topbar pad 24, search 480, bell menu 360, profile menu 280, dialog 480, toast 24px in', () => {
    const body = (sel: string) => blocks(styles).find((x) => x.sel.includes(sel))!.body;
    expect(body('.topbar')).toMatch(/padding: 0 var\(--space-6\)/);
    expect(tok('space-search')).toBe('480px');
    expect(tok('space-dialog')).toBe('480px');
    expect(tok('space-topbar')).toBe('64px');
    expect(body('.searchbox')).toMatch(/max-width: var\(--space-search\)/);
    expect(body('.bell-menu')).toMatch(/width: 360px/);
    expect(body('.profile .menu')).toMatch(/width: 280px/);
    expect(body('.toasts')).toMatch(/right: var\(--space-6\); bottom: var\(--space-6\)/);
    expect(body(".sidebar a[aria-current='page']")).toMatch(/rgba\(0, 0, 0, 0\.08\).*font-weight: 600/);
    expect(body('.bell .dot')).toMatch(/width: 8px; height: 8px/);
  });

  it('content sits full-bleed on the sheet; banners avoid the warn wash', () => {
    const body = (sel: string) => blocks(styles).find((x) => x.sel.includes(sel))!.body;
    expect(body('.sheet')).toMatch(/padding: var\(--space-content-pad\) var\(--space-8\) var\(--space-12\)/);
    expect(body('.sheet')).not.toMatch(/border|radius|margin/);
    const banners = blocks(styles).filter((x) => x.sel.some((s) => /\.banner\b/.test(s)));
    expect(banners.length).toBeGreaterThan(0);
    for (const b of banners) expect(b.body).not.toMatch(/pill-warn/);
    const sel = (x: string) => blocks(styles).find((b) => b.sel.includes(x))!.body;
    expect(sel('.banner.update')).toMatch(/pill-info-bg[\s\S]*banner-info-ink/);
    expect(sel('.banner.update.bad')).toMatch(/pill-neg-bg[\s\S]*pill-neg-ink/);
  });

  it('empty state: 240px art, 144px compact, 44ch line; dialog actions right-aligned; profile pill with small avatar', () => {
    const body = (sel: string) => blocks(styles).find((x) => x.sel.includes(sel))!.body;
    expect(body('.empty-state .illo')).toMatch(/height: 240px/);
    expect(body('.empty-state.compact .illo')).toMatch(/height: 144px/);
    expect(body('.empty-state p')).toMatch(/max-width: 44ch/);
    expect(body('.scrim .dialog .actions')).toMatch(/justify-content: flex-end; margin-top: var\(--space-6\)/);
    expect(body('.btn')).toMatch(/line-height: 1\.33/);
    expect(body('.profile-btn')).toMatch(/padding: var\(--space-1\) var\(--space-2\) var\(--space-1\) var\(--space-1\)[\s\S]*border-radius: var\(--radius-full\)/);
    expect(body('.avatar.small')).toMatch(/width: 24px; height: 24px/);
    expect(body('.assist-chips .chip-btn')).toMatch(/padding: 4px var\(--space-3\)/);
  });

  it('review: 320 + fluid grid, list scrolls past 600, bordered cards with accent ring, full-bleed sticky savebar, 3-col tags', () => {
    const body = (sel: string) => blocks(styles).find((x) => x.sel.includes(sel))!.body;
    expect(body('.rv')).toMatch(/grid-template-columns: 320px minmax\(0, 1fr\)/);
    expect(body('.rv-list')).toMatch(/max-height: 600px; overflow-y: auto/);
    expect(body('.gl')).toMatch(/border: 1px solid/);
    expect(body(".gl[aria-current='true']")).toMatch(/box-shadow: 0 0 0 1px var\(--color-accent\)/);
    expect(body('.strip img')).toMatch(/width: 40px/);
    expect(body('.gl:focus-visible')).toMatch(/outline-offset: -2px/);
    expect(body('.savebar')).toMatch(/padding: var\(--space-4\) var\(--space-8\)/);
    expect(body('.savebar')).toMatch(/position: sticky; bottom: 0[\s\S]*border-top[\s\S]*calc\(var\(--space-8\) \* -1\)/);
    expect(body('.tags-grid')).toMatch(/repeat\(3, minmax\(0, 1fr\)\)/);
  });

  it('review editor: 6-col photo toggles, 2-col organizer, 64px confidence meter, no menu chrome', () => {
    const body = (sel: string) => blocks(styles).find((x) => x.sel.includes(sel))!.body;
    expect(body('.thumbs')).toMatch(/grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)[\s\S]*gap: var\(--space-2\)/);
    expect(body(".th[aria-pressed='true']")).toMatch(/border-color: var\(--color-accent\)/);
    expect(body('.tick')).toMatch(/width: 20px; height: 20px/);
    expect(body('.org')).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
    expect(body('.org-row:last-child')).toMatch(/grid-column: 1 \/ -1/);
    expect(body('.conf .meter')).toMatch(/width: 64px/);
    expect(styles).not.toMatch(/\.menuwrap|\.menubtn|\.photos\b/);
  });

  it('avatar is a 32px dark circle', () => {
    const b = blocks(styles).find((x) => x.sel.includes('.avatar'))!.body;
    expect(b).toMatch(/width: 32px/);
    expect(b).toMatch(/background: var\(--color-ink-2\)/);
  });
});

// jsdom has no layout, so axe cannot compute colour-contrast there; the declared text pairs are checked here instead (WCAG AA 4.5:1).
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const GRAY_OVER_WHITE = '#f2f2f2'; // rgba(0,0,0,.05) on #fff
const c = (n: string) => tok(`color-${n}`)!;

describe('text contrast (AA)', () => {
  it.each([
    ['info pill', () => [c('pill-info-ink'), c('pill-info-bg')]],
    ['pos pill', () => [c('pill-pos-ink'), c('pill-pos-bg')]],
    ['warn pill', () => [c('pill-warn-ink'), c('pill-warn-bg')]],
    ['neg pill', () => [c('pill-neg-ink'), c('pill-neg-bg')]],
    ['neutral pill', () => [c('pill-neutral-ink'), GRAY_OVER_WHITE]],
    ['meta text on sheet', () => [c('faint'), c('sheet')]],
    ['info banner', () => [c('banner-info-ink'), c('pill-info-bg')]],
    ['banner on frame', () => [c('ink-2'), c('frame')]],
    ['meta text on frame', () => [c('faint'), c('frame')]],
    ['muted text on frame', () => [c('muted'), c('frame')]],
    ['button ink on secondary fill', () => [c('ink'), GRAY_OVER_WHITE]],
    ['white on avatar / toast', () => [c('primary-text'), c('ink-2')]],
    ['white on primary', () => [c('primary-text'), c('primary')]],
  ] as const)('%s', (_n, pair) => {
    const [fg, bg] = pair();
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
