// Throwaway spike 5: streaming ZIP writers. Usage: node run.mjs <lib> <photos> <MiB> <out.zip> [cancelAfterPhotos]
import { createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { once } from 'node:events'

const [lib, N, MIB, OUT, CANCEL] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5], process.argv[6] ? +process.argv[6] : 0]
const MTIME = new Date(Date.UTC(2026, 0, 1, 0, 0, 0))
const chunk = Buffer.alloc(1 << 20, 7)
const photo = (i) => Readable.from((async function* () { for (let m = 0; m < MIB; m++) { chunk[0] = (i + m) & 255; yield Buffer.from(chunk) } })())
let peak = 0
const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 50)
const file = createWriteStream(OUT)
let cancelled = false, active
const t0 = Date.now()
const closed = () => { const p = once(file, 'close'); p.catch(() => {}); return p }
const gate = async (i) => { if (CANCEL && i === CANCEL) { cancelled = true; throw new Error('cancelled') } }

async function yazl() {
  const { ZipFile } = await import('yazl'), z = new ZipFile()
  active = () => z.outputStream.unpipe(file)
  z.outputStream.pipe(file)
  const done = closed()
  for (let i = 0; i < N; i++) { await gate(i); z.addReadStream(photo(i), `g/photo-${i}.jpg`, { compress: false, mtime: MTIME, mode: 0o100644, forceZip64Format: process.env.FORCE64 === '1' }); await new Promise((r) => setTimeout(r, 0)) }
  z.end(); await done
}
async function archiver() {
  const { ZipArchive } = await import('archiver'), z = new ZipArchive({ store: true })
  z.pipe(file)
  const done = closed()
  for (let i = 0; i < N; i++) { await gate(i); z.append(photo(i), { name: `g/photo-${i}.jpg`, date: MTIME, mode: 0o100644, store: true }) }
  await z.finalize(); await done
}
async function fflate() {
  const { Zip, ZipPassThrough } = await import('fflate')
  const z = new Zip((err, data, final) => { if (err) throw err; file.write(data); if (final) file.end() })
  const done = closed()
  for (let i = 0; i < N; i++) {
    await gate(i)
    const e = new ZipPassThrough(`g/photo-${i}.jpg`); e.mtime = MTIME; z.add(e)
    for await (const c of photo(i)) { e.push(c); if (file.writableLength > 8 << 20) await once(file, 'drain') }
    e.push(new Uint8Array(0), true)
  }
  z.end(); await done
}
async function zipjs() {
  const { ZipWriter } = await import('@zip.js/zip.js')
  const z = new ZipWriter(Writable.toWeb(file), { level: 0, lastModDate: MTIME })
  for (let i = 0; i < N; i++) { await gate(i); await z.add(`g/photo-${i}.jpg`, Readable.toWeb(photo(i)), { level: 0, lastModDate: MTIME }) }
  await z.close()
}
try { await { yazl, archiver, fflate, zipjs }[lib]() } catch (e) {
  if (!cancelled) { console.log(`${lib}: FAIL ${e.message}`); process.exitCode = 1 }
  active?.(); file.destroy(); await once(file, 'close').catch(() => {})
  const before = existsSync(OUT) ? statSync(OUT).size : 0
  await new Promise((r) => setTimeout(r, 300))
  const after = existsSync(OUT) ? statSync(OUT).size : 0
  try { unlinkSync(OUT) } catch {}
  console.log(`${lib}: ${cancelled ? 'cancel' : 'error'} partial ${before} B, grew-after-destroy ${after - before} B, removed ${!existsSync(OUT)}`)
}
clearInterval(t)
if (!cancelled && existsSync(OUT) && !process.exitCode) console.log(`${lib}: wrote ${(statSync(OUT).size / 2 ** 30).toFixed(2)} GiB in ${((Date.now() - t0) / 1000).toFixed(1)} s, peak RSS ${(peak / 2 ** 20).toFixed(0)} MiB`)
