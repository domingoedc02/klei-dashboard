// Builds the original renderer with the Electron-owned config (electron/vite.config.mjs, story 14.4).
// Usage: node electron/test/parity/build-renderer.mjs [baseline|electron]  (default: both)
import { baselineConfig, BASELINE_OUTDIR, config, loadVite, OUTDIR } from '../../vite.config.mjs'

const { build } = await loadVite()
const which = process.argv[2] ?? 'both'
if (which !== 'electron') { await build(baselineConfig); console.log(BASELINE_OUTDIR) }
if (which !== 'baseline') { await build(config); console.log(OUTDIR) }
