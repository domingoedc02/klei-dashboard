import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const OUT = join(ROOT, 'docs/planning-artifacts/ui-parity');
export const PROTO_DIR = process.env.PROTOTYPE_DIR ?? '/Users/ej/Downloads/Klei-Bridal-Dashboard-Prototype';
export const VIEWPORT = { width: 1440, height: 900 };

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpeg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml' };

/** Static server for the prototype folder on a random port. */
export function serveDir(dir) {
  const srv = createServer(async (req, res) => {
    try {
      const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      const file = join(dir, p === '/' ? 'index.html' : p);
      if (!file.startsWith(dir)) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

/** Same freeze on both sides: no animation, no transition, no caret, no stray focus ring or toast. */
export const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

export async function settle(page) {
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    const t = document.getElementById('toasts');
    if (t) t.innerHTML = '';
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(80);
}

export const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]);
};

// The prototype ships no @font-face (it falls back to the OS font); the desktop ships Inter 400-700. Give the prototype the same files so type metrics compare.
const FONT_DIR = join(ROOT, 'backend/app/src/main/resources/static/fonts');
export const INTER_CSS = [400, 500, 600, 700]
  .map((w) => `@font-face{font-family:Inter;font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(join(FONT_DIR, `inter-latin-${w}.woff2`)).toString('base64')}) format('woff2')}`)
  .join('');
