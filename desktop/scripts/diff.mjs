// Pairs ui-parity/prototype/<n>.png with ui-parity/desktop/<n>.png -> diff/<n>.png (proto | desktop | diff) + report.json (pixel % per pair).
// The % is a trend metric only (fixtures and fonts differ slightly); the gate is geometry.json (zero overlap/overflow) plus a visual read of each pair.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { OUT, arg } from './shots/common.mjs';
import { SCREENS, name } from './shots/screens.mjs';

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
// Per-screen desktop geometry findings by kind (text-ellipsis is reported but is not a failure where the prototype truncates the same text).
const geo = await readFile(join(OUT, 'geometry.json'), 'utf8').then(JSON.parse, () => ({}));
report.geometry = Object.fromEntries(Object.entries(geo).map(([n, sides]) => [n, (sides.desktop ?? []).reduce((c, i) => ((c[i.kind] = (c[i.kind] || 0) + 1), c), {})]).filter(([, c]) => Object.keys(c).length));
report.pending = SCREENS.filter((s) => s.desk?.pending).map((s) => ({ name: name(s), story: s.desk.pending }));
// A --only run keeps the pairs it did not recompute.
const old = only ? (await readFile(join(OUT, 'report.json'), 'utf8').then(JSON.parse, () => ({ pairs: [] }))).pairs : [];
const fresh = new Set(report.pairs.map((p) => p.name));
report.pairs = [...old.filter((p) => !fresh.has(p.name) && proto.has(`${p.name}.png`) && desk.has(`${p.name}.png`)), ...report.pairs].sort((a, b) => a.name.localeCompare(b.name));
for (const p of report.pairs) { delete p.pending; const s = report.pending.find((x) => x.name === p.name)?.story; if (s) p.pending = s; }
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`${report.pairs.length} pairs | proto-only ${report.protoOnly.length} | desktop-only ${report.deskOnly.length} | pending ${report.pending.length} | screens with desktop geometry findings ${Object.keys(report.geometry).length}`);
