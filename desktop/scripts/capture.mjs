// Usage: node scripts/capture.mjs [--side prototype|desktop|both] [--only <id-state substring>]
// Output: docs/planning-artifacts/ui-parity/{prototype,desktop}/<id>-<state>.png at 1440x900.
import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { OUT, PROTO_DIR, VIEWPORT, INTER_CSS, serveDir, settle, arg } from './shots/common.mjs';
import { SCREENS, name } from './shots/screens.mjs';
import { probe, record, flush } from './shots/probe.mjs';

const side = arg('side', 'prototype');
const only = arg('only', '');
const wanted = SCREENS.filter((s) => name(s).includes(only === true ? '' : only));
const failures = [];

async function proto(browser) {
  const srv = await serveDir(PROTO_DIR);
  const dir = join(OUT, 'prototype');
  await mkdir(dir, { recursive: true });
  for (const s of wanted) {
    if (!s.proto) continue;
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    try {
      await page.goto(srv.url, { waitUntil: 'load' });
      await page.addStyleTag({ content: '.stsel,.seg[aria-label="Wireframe state"],[data-act="toggle-role"]{display:none!important}' + INTER_CSS }); // prototype-only wireframe toggle + View-as row, not product UI
      await s.proto(page);
      await settle(page);
      record('prototype', name(s), await probe(page));
      await page.screenshot({ path: join(dir, `${name(s)}.png`) });
      console.log('proto ok  ', name(s), errs.length ? `(console: ${errs[0].slice(0, 80)})` : '');
    } catch (e) {
      failures.push(`proto ${name(s)}: ${String(e).split('\n')[0]}`);
      console.log('proto FAIL', name(s), String(e).split('\n')[0]);
    }
    await ctx.close();
  }
  srv.close();
}

const browser = await chromium.launch();
try {
  if (side === 'prototype' || side === 'both') await proto(browser);
  if (side === 'desktop' || side === 'both') {
    const { captureDesktop } = await import('./shots/desktop.mjs');
    failures.push(...(await captureDesktop(browser, wanted)));
  }
} finally {
  await browser.close();
  await flush();
}
if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n` + failures.join('\n'));
  process.exit(1);
}
