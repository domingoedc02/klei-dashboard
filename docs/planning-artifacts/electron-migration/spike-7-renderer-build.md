# Spike 7: read-only renderer build and shim (story 14.4)

Date 2026-11-14. macOS 26.6 arm64, Electron 45.3.2, Vite 8.3.6, React 19.3.1, `@tauri-apps/api` 2.12.4 (all resolved read-only from `desktop/node_modules`; `desktop/package-lock.json` is byte-identical to the baseline). Code: `electron/vite.config.mjs`, `electron/src/renderer-compat/core.ts`, `electron/spikes/04-shim/`.

## Decision
**Option B.** An Electron-owned Vite config builds `desktop/` sources with `resolve.alias['@tauri-apps/api/core']` pointing at `electron/src/renderer-compat/core.ts`. The preload exposes nine named methods on `window.klei`. No command name crosses preload. Options A and C were not needed.

## Evidence
| Check | Result |
|---|---|
| Build writes only under `electron/` (`build/`, `.cache/`) | yes; `git status --porcelain --untracked-files=all -- desktop` empty before and after; `git diff --stat 51949da… -- desktop` empty; `desktop/dist` and `desktop/node_modules/.vite` keep their 2026-11-13 timestamps |
| Output references `localhost:1420` or `__TAURI_INTERNALS__` | neither (the baseline build, without the alias, contains `__TAURI_INTERNALS__`) |
| Real Electron, `contextBridge`: `bridge.request` | handler gets `{method,path,body,ifMatch,idempotencyKey}` exactly as the Tauri call carries it; `null` for omitted fields |
| Rejection | `{kind:"no_access",message:"denied"}` reaches the caller; `JSON.stringify` shows exactly those two keys; it is a plain object, not an `Error` (as with Tauri) |
| `uploadFiles` and `exportGowns` with a Channel | callback receives events in index order (3 of 3, and 500 of 500 in order, three runs), resolves only after the end marker |
| Exposed object keys | exactly nine |
| Parity, 72 screen states | original bundle with the Tauri shim vs Electron bundle with `window.klei`: 72 pairs, 0 missing, 0 extra, 0 different; PNGs byte-identical; `probe.json` identical |
| `desktop/dist` untouched | yes |

## The `contextBridge` finding
Class instances do not cross `contextBridge`, and functions passed in from the page arrive as proxies. So the `Channel` class lives in the alias module in the page, and `invoke` passes preload a plain callback. Preload delivers `{index,message}` events in index order and does not resolve the call until the `{end:true}` marker arrives, which also protects against the reply overtaking the last events. Errors cannot cross as thrown objects either (a rejected `ipcRenderer.invoke` becomes `Error invoking remote method … [object Object]`), so main answers `{ok}|{err}` and preload rethrows a plain `{kind,message}`. This envelope is part of the 15.3 and 15.4 contract.

## Not covered
- The production preload, its sender validation and the `app://` scheme are 15.2 to 15.4. The spike preload has no frame check.
- Cancellation, concurrent runs and event backpressure beyond 500 events were not exercised.
- `desktop/node_modules` is still the dependency source. 15.1 decides whether `electron/` installs its own pinned copy.
- `set_dirty` and the other six non-stream commands were exercised through `bridge.ts` only for `request`, `setDirty` and `signIn`.
