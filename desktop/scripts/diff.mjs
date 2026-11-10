// Pairs ui-parity/prototype/<n>.png with ui-parity/desktop/<n>.png -> diff/<n>.png (proto | desktop | diff) + report.json (pixel % per pair).
// The % is a trend metric only (fixtures and fonts differ slightly); the gate is geometry.json (zero overlap/overflow) plus a visual read of each pair.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { OUT, arg } from './shots/common.mjs';

const only = arg('only');
const png = async (p) => PNG.sync.read(await readFile(p));
const ls = async (d) => new Set((await readdir(join(OUT, d))).filter((f) => f.endsWith('.png') && !f.endsWith('.FAILED.png')));

const [proto, desk] = [await ls('prototype'), await ls('desktop')];
await mkdir(join(OUT, 'diff'), { recursive: true });
const report = { pairs: [], protoOnly: [...proto].filter((f) => !desk.has(f)).map((f) => f.slice(0, -4)), deskOnly: [...desk].filter((f) => !proto.has(f)).map((f) => f.slice(0, -4)) };

for (const f of [...proto].filter((f) => desk.has(f) && (!only || f.includes(only)))) {
  const [a, b] = [await png(join(OUT, 'prototype', f)), await png(join(OUT, 'desktop', f))];
  const { width: w, height: h } = a;
  const d = new PNG({ width: w, height: h });
  const bad = a.width === b.width && a.height === b.height ? pixelmatch(a.data, b.data, d.data, w, h, { threshold: 0.1 }) : w * h;
  const m = new PNG({ width: w * 3, height: h });
  [a, b, d].forEach((img, i) => PNG.bitblt(img, m, 0, 0, Math.min(img.width, w), Math.min(img.height, h), i * w, 0));
  await writeFile(join(OUT, 'diff', f), PNG.sync.write(m));
  report.pairs.push({ name: f.slice(0, -4), pct: +((bad / (w * h)) * 100).toFixed(2) });
}
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`${report.pairs.length} pairs | proto-only ${report.protoOnly.length} | desktop-only ${report.deskOnly.length}`);
