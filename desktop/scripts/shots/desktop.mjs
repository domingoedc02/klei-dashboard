// Desktop side of the capture: the Vite app in Chromium, Tauri IPC faked by tauri-shim, API answered from fixtures.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT, VIEWPORT, settle } from './common.mjs';
import { installShim } from './tauri-shim.mjs';
import { NOW, makeHandler, routes, imgSvg } from './fixtures.mjs';
import { SCREENS, name } from './screens.mjs';
import { probe, record } from './probe.mjs';

const URL_ = 'http://localhost:1420';
const up = () => fetch(URL_).then((r) => r.ok, () => false);

async function vite() {
  if (await up()) return { close() {} };
  const p = spawn('npx', ['vite', '--port', '1420', '--strictPort'], { cwd: new URL('../../', import.meta.url).pathname, stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
  if (!(await up())) { p.kill(); throw new Error('vite did not start on :1420'); }
  return { close: () => p.kill() };
}

export async function captureDesktop(browser, wanted) {
  const failures = [];
  const dir = join(OUT, 'desktop');
  await mkdir(dir, { recursive: true });
  const srv = await vite();
  try {
    for (const s of wanted) {
      if (!s.desk) continue;
      const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const notes = [];
      const log = (m) => notes.push(m);
      page.on('pageerror', (e) => log(`pageerror ${e}`));
      page.on('console', (m) => m.type() === 'error' && log(`console ${m.text()}`));
      await page.route('klei-img://**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: imgSvg(r.request().url()) }));
      try {
        const table = routes();
        s.desk.fx?.(table);
        await installShim(page, makeHandler(table, log), log);
        await page.clock.setFixedTime(NOW);
        await page.goto(`${URL_}/${s.desk.hash}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(s.desk.ready ?? '.app', { timeout: 15000 });
        await s.desk.after?.(page);
        await page.mouse.move(1439, 899); // park the pointer so a clicked control is not captured hovered
        await settle(page);
        record('desktop', name(s), await probe(page));
        await page.screenshot({ path: join(dir, `${name(s)}.png`) });
        const bad = notes.filter((n) => !n.startsWith('console Failed to load resource'));
        console.log(bad.length ? 'desk WARN' : 'desk ok  ', name(s), ...bad);
        if (bad.length) failures.push(`desk ${name(s)}: ${bad.join(' | ')}`);
      } catch (e) {
        failures.push(`desk ${name(s)}: ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: join(dir, `${name(s)}.FAILED.png`) }).catch(() => {});
      }
      await ctx.close();
    }
  } finally {
    srv.close();
  }
  return failures;
}
