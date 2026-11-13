# Spike 4: no business content on disk

Date 2026-11-14. macOS 26.6 arm64, Electron 45.3.2. Code: `electron/spikes/4-no-disk/`.

## Question
With the planned `webPreferences` (`contextIsolation`, `sandbox`, no `nodeIntegration`), does a profile directory end up holding API JSON or images?

## Method
A page on an `app://klei/` scheme fetches JSON and an SVG image, each containing a random sentinel string, from a loopback server that sends `Cache-Control: public, max-age=3600` and an `ETag`, then writes the sentinel to `localStorage` and IndexedDB. The app exits after 2.5 s. `userData` and `sessionData` point to a temp directory; every file there is searched for the sentinel as UTF-8 and UTF-16LE. Run twice: default session, and a non-persistent partition (`session.fromPartition('klei-mem')`, no `persist:` prefix). A second app (`main-fetch.mjs`) tests main-process fetches.

## Result

| Variant | Sentinel found in |
|---|---|
| Renderer on the default session | `Cache/Cache_Data` (2 files), IndexedDB LevelDB log, Local Storage LevelDB log |
| Renderer on a non-persistent partition | nowhere. The `Cache`, `IndexedDB`, `Cookies` directories are never created. |
| Main process `net.fetch` on the default session | `Cache/Cache_Data` (1 file) |
| Main process `net.fetch` with `cache: 'no-store'` | nowhere |
| Main process `session.fromPartition('mem').fetch` | nowhere |
| Main process Node `fetch` | nowhere; only `GPUPersistentCache`, `GraphiteDawnCache`, `Local State` exist |

Left on disk in the non-persistent run, none containing the sentinel: `Code Cache` (index files, 24 to 48 bytes), `Extension State`, `GPUPersistentCache`, `GraphiteDawnCache` (about 5.5 MB of GPU shader data), `Local State`, `Local Storage` and `Session Storage` (LevelDB bookkeeping, 30 bytes of log), `Network Persistent State`, `Preferences`, `Trust Tokens`, `declarative_performance_observer.db`. No log or crash-dump files appeared in `~/Library/Logs` or `~/Library/Caches` for the test app names.

## Decision
- Create one non-persistent session for the renderer and for every main-process request that touches business data: `session.fromPartition('klei')`, never `persist:`.
- Never use `defaultSession` for content. Use Node `fetch` for API calls where cookies and Chromium networking are not needed, and an in-memory session otherwise.
- Wire `protocol.handle('app', …)` on that session.
- 15.2 asserts in a test that no `Cache`, `IndexedDB` or `Cookies` directory exists after a run, and runs this sentinel scan in CI.

## Residual risk
- A string sentinel proves only that text is not stored. A cached JPEG would not contain it; the absence of the `Cache` directory is the stronger evidence.
- Shader caches (`GraphiteDawnCache`, `GPUPersistentCache`) still exist. They hold GPU programs, not content. Untested switches to remove them: `--disable-gpu-shader-disk-cache`, `--disk-cache-size=0`. Crash reporter and `--log-file` were not enabled, so crash dumps and logs are untested.
- **Found along the way, affects 15.1:** an ESM main file that does `await app.whenReady()` at the top level never starts (hangs with no output) on Electron 45.3.2. `app.whenReady().then(…)` works. 15.1 uses CommonJS or `.then`.
- Windows and Linux not verified.
