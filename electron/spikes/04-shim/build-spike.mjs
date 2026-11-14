import { join } from 'node:path'
import { config, loadVite } from '../../vite.config.mjs'
const { build } = await loadVite()
const outDir = join(import.meta.dirname, '../../build/spike04')
try { await build({ ...config, publicDir: false, build: { ...config.build, outDir, lib: { entry: join(import.meta.dirname, 'test-entry.ts'), formats: ['iife'], name: 'T', fileName: () => 'test.js' } } }) } catch (e) { for (const x of e.errors ?? [e]) console.log(String(x.text ?? x.message ?? x).slice(0, 200), x.location ? `@ ${x.location.file}:${x.location.line}` : ''); process.exit(1) }
console.log(outDir)
