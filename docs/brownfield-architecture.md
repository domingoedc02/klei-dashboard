# Brownfield architecture inventory: Tauri desktop

**Baseline:** `8083c944b523285c1fce33bb2f1d3331bc0c350d` (Epic 21 stories 21.1 to 21.7; this inventory was written at `51949da2a0f8347c5f1f56fc5d87d8ada6e60643`, Epic 13 complete). Read-only inventory; no application files changed. `prototype/v0.1.0/` is a static visual reference, not the running product. The real renderer is `desktop/`.

## Authority and scope

- This document records the current Tauri implementation and traces its proposed Electron ownership. It does not authorize implementation or retire Tauri.
- Existing architecture decisions AD-1–AD-21 remain authoritative for the current app. `docs/architecture.md`'s Electron addendum and the spine's AD-22 onward govern only a future Electron target; unresolved proposals remain subject to the owner’s cutover decision.
- Product requirements, UI, APIs, and original runtime source stay unchanged. Migration backlog ownership below refers to proposed Epic 14–20 stories, not completed work.

## Current shape

| Area | Current implementation | Electron destination (proposed) |
| --- | --- | --- |
| Renderer | React 19, TypeScript 5.9, Vite 8; `desktop/src/`; `desktop/src/main.tsx`; hash routing. `desktop/vite.config.ts` builds ES2022 into `desktop/dist/`, assets remain external files. | Electron-hosted renderer built from `desktop/src/` read-only; compatibility alias in Electron-owned renderer/build config. 14.4, 15.3 |
| Native shell | Rust/Tauri 2 in `desktop/src-tauri/src/`; `lib.rs` registers protocols, plugins, drag/drop, state, commands. | Node in Electron main; no Rust sidecar. 16.x–17.x |
| API/session | `session.rs`, `pkce.rs`, `loopback.rs`, `keychain.rs`, `config.rs`; main-side signed HTTPS requests and auth. | `electron/src/main/{session,auth,keychain,config}.ts`. 16.1–16.6 |
| Renderer bridge | Sole direct Tauri import: `desktop/src/bridge.ts` imports `invoke`, `Channel` from `@tauri-apps/api/core`. `bridge` methods wrap all nine commands. | Keep source bytes untouched; Vite alias that import to an Electron-owned typed compatibility module. Only named bridge methods cross `contextBridge`. 14.4, 15.3–15.4 |
| Backend / API | Separate existing `backend/`; desktop does not own or change it. OpenAPI types: `desktop/src/api/schema.d.ts`. | Electron reuses the same API contract; no backend/API migration. |
| Packaging and CI | Tauri config, Rust/Cargo lockfiles, `.github/workflows/desktop.yml`, `release.yml`; details below. | Isolated root `electron/`, its own dependencies/lockfile/output/config and separately approved workflows. 14.1, 18.x–19.x |

### Native modules

| Source | Current responsibility | Electron story |
| --- | --- | --- |
| `commands.rs`, `error.rs` | Closed nine-command surface; `{kind,message}` errors, messages avoid tokens/codes/response bodies. | 15.4 |
| `config.rs`, `session.rs` | Fixed API/Auth origins, 10 s default request timeout, 120 s upload timeout, 300 s sign-in timeout; `/health/ready` GET exception; path/method/idempotency validation; bearer auth, refresh single-flight, one 401 refresh/retry, dirty state. | 16.1–16.2, 16.6 |
| `pkce.rs`, `loopback.rs`, `lib.rs` | PKCE S256 and state; system-browser auth; `klei://auth/callback`; loopback fallback; single-instance URL handling. | 16.4–16.5 |
| `keychain.rs` | Refresh token under service `co.klei.bridal`, account `refresh-token`; access token in memory; fail closed on keychain errors; explicit session-only in-memory mode. Debug/smoke may use memory by configuration. | 14.3, 16.3 |
| `uploads.rs` | File metadata/read only; 25 MiB photo limit, 200-photo batch cap (lifted by Story 21.6: the server's ceiling answers 413 with `limit`), 3 concurrent workers, stable idempotency key, retry, cancellation, triage, avatar and attachment limits; no temp/cache copy. | 17.1–17.3 |
| `export.rs` | Fetch manifest/photos, sanitize cross-platform names, serialize one export, write ZIP only to user-selected path; remove partial ZIP on failure/cancel. | 17.4 |
| `thumbs.rs`, `lib.rs` | `klei-img` GET protocol, UUID/revision path allowlist, authenticated API fetch, 300 s bounded in-memory thumbnail cache (max 400), originals/avatar uncached; `no-store`, `nosniff`, MIME from bytes. | 17.5 |
| `update.rs` | Tauri updater check/download/minisign verification/install/restart; dirty-work gate, 30 s check and 15 min download timeout. Config endpoint and key currently placeholders. | 18.3; approved Electron behavior is explicitly different |
| `lib.rs`, `commands.rs` | Dialog plugin used by Rust for photo/avatar/attachment pickers and ZIP save dialog; deep-link, single-instance, updater plugins; `open::that` for system browser. | 16.4–16.5, 17.1–17.4, 18.3 |

## Command and callback contract map

Exactly nine `#[tauri::command]` functions are registered in `commands.rs`, `lib.rs`, `build.rs`, and `capabilities/default.json`; `desktop/src-tauri/tests/contract.rs` checks the closed set and persistence/security boundaries. `desktop/src/bridge.ts` is the only renderer caller/wrapper. Electron API operations below are intended typed methods, not raw generic IPC.

| Command / caller | Observable contract and edge behavior | Electron owner / story | Verification required |
| --- | --- | --- | --- |
| `api_request` — `bridge.request`; `App.tsx`, `Shell.tsx`, feature request wrappers | Method/path/body, optional `ifMatch`, `idempotencyKey`; `{status,body,refreshed}`; only approved methods and `/api/v1/` paths plus read-only `/health/ready`; 10 s default (named AI provider paths up to 200 s); refresh single-flight and retry once on 401; fixed typed errors. | `main/session.ts`, `main/ipc.ts`, `preload/contracts.ts`; 15.4, 16.1–16.2 | Contract tests for validation, timeout, health exception, refresh races, 401 retry, errors and token/body redaction. |
| `sign_in` — `App.tsx` | Starts system-browser OAuth authorization-code + PKCE; waits up to 300 s for matching state; callback consumed once; concurrent start supersedes prior pending flow; cancellation/timeout errors. | `main/auth.ts`, `main/session.ts`; 16.4–16.5 | PKCE vectors, callback/state/replay, timeout, browser and OS callback runtime checks. |
| `sign_out` — `App.tsx` | Clears access/pending state, best-effort server logout if refresh token available, clears keychain; keychain clear failure surfaces. | `main/session.ts`, `main/keychain.ts`; 16.3 | Token-state and keychain failure checks; no secret logging. |
| `session_only` — sign-in screen in `App.tsx` | Switches future refresh-token persistence to process memory; next launch requires sign-in. | `main/keychain.ts`; 16.3 | Explicit user-consented fallback; prove no disk persistence. |
| `set_dirty` — `Shell.tsx`, `Review.tsx` | Updates process session dirty flag; update attempt refuses while unsent work exists. | `main/session.ts`; 16.6, 18.3 | Dirty/clean lifecycle and quit/update flow tests. |
| `check_update` — `useUpdate.tsx` | Returns `{status:'none'}` or `{status:'available',version}`; current UI checks at startup and every 24 h, manual check can toast. Existing Tauri code checks configured updater feed; config values are placeholders. | `main/updates.ts`, renderer alias/frozen UI copy; 18.3 | Download-site `latest.json` (18.5); strict bounded manifest schema/version, timeout, response-size limit, redirects disabled; test no feed URL/secret leaks. |
| `install_update` — `useUpdate.tsx` | Existing Tauri command gates dirty work, downloads, verifies, installs and restarts. | Compatibility name only: dirty guard then open the download site's page (fixed base URL with secret path, 18.5) in the system browser. Electron UI must say “Download update” / “manual install,” never “Install and restart.” 18.3 | Test dirty refusal and immutable URL; no auto download/install/restart or signature-verification claim. |
| `upload_files` — `Upload.tsx`, `Review.tsx`, `Composer.tsx`, `ProfileTab.tsx` | `photo` native multi-picker; `dropped` consumes most recent native drop; `attachment` multi-picker; `avatar` single picker; `cancel`; `watch`/`unwatch`. Returns summary; `Channel<UploadEvent>` carries progress, drag, dropped count. Paths/bytes never reach renderer. | `main/uploads.ts`, `main/ipc.ts`, `preload` listener methods; 17.1–17.3 | Preserve per-kind validation, paths private, event ordering/cancellation and listener disposal on screen lifecycle; native dialog and file tests. |
| `export_gowns` — `gallery/download.tsx` | `start` fetches manifest, opens native save dialog, writes ZIP with per-gown details/photos; channel progress; single active export; `cancel` removes partial output. | `main/export.ts`, `main/ipc.ts`; 17.4 | ZIP names/content, save-dialog cancel, progress, concurrent-start rejection, cancellation/partial-file cleanup. |

**Callback semantics:** Tauri `Channel<T>` is created in `bridge.ts`; upload watch persists until `unwatch`, while per-run upload/export progress belongs to its invocation. Electron preload must register typed listeners separately, return unsubscribe handles, reject malformed/out-of-sequence events, and bind callbacks to request/window lifetime. Cancellation is an explicit operation; closing a renderer must not orphan listeners or native jobs.

## Native surfaces and renderer behavior

| Surface / source | Existing behavior | Target / owner |
| --- | --- | --- |
| `klei-img://localhost` in `platform.ts`, `thumbs.rs`, `lib.rs` | Thumbnail/full/avatar URL helpers; Windows uses `http://klei-img.localhost`. API validates paths and session; no-store; only thumbnails cached in bounded process memory. | Electron-owned protocol handler and renderer-only alias/copy for Windows hostname; no disk cache. 17.5 |
| Window drag/drop in `lib.rs`, `uploads.rs` | Native window Enter/Leave/Drop; paths held only for active Upload screen and 10 s, drop count event, `dropped` consumes them; no HTML5 drop handler. | Preload DOM `dragenter/dragleave/dragover/drop` capture (Electron has no native window drop event); `webUtils.getPathForFile` in preload; private sender-validated IPC to main; scoped watch/unwatch and 10 s TTL; packaged-app drag check. 17.2 |
| Deep link and single-instance in `lib.rs`, `session.rs` | `klei://auth/callback`, launch/relaunch URL delivery; Linux loopback fallback if scheme registration unavailable/forced. | Preview identity/scheme must not steal production `klei://`; runtime-tested callback and loopback. 16.5 |
| System dialogs and external browser | Dialogs are Rust-side only; open/save via dialog plugin; auth and external links via OS opener. | Main-process native dialogs and a fixed allowlist of system-browser destinations. Never renderer-supplied URL. 16.4, 17.1–17.4, 18.3 |
| Clipboard, composer, lifecycle | `navigator.clipboard.writeText`, `document.execCommand` including `insertText`, and `beforeunload` are used in renderer. Hash routing. | Preserve tested browser/runtime behavior; no new feature or route model. 17.6 |

### Configured, absent, and persistence

- Window label `main`, title `Klei Bridal`, 1280×800 default, 1100×700 minimum; identifier `co.klei.bridal`; Tauri `withGlobalTauri:false`. Release CSP disallows renderer network (`connect-src 'none'`); `klei-img:` and data images allowed. Dev CSP separately permits local Vite server/WebSocket and inline development code.
- One capability grants only the nine app commands. Dialog use is Rust-side; no renderer dialog permission. Updater/deep-link/single-instance are configured native plugins, not renderer-callable plugin APIs.
- `tauri.conf.json` bundles all targets, deep-link scheme `klei`, updater endpoint/public key placeholders. `tauri.release.conf.json` enables updater artifacts. `desktop/src-tauri/tests/contract.rs` verifies exact commands, CSP, identity, dimensions, scheme, updater URL shape, and no browser storage APIs.
- Credential persistence: refresh token only in OS keychain unless explicit/session-mode memory; access token and auth state in process memory. No browser local/session storage, IndexedDB, cookies, or business-content disk cache. Photo reads are in memory; ZIP is the one intentional user-selected plaintext output. Tauri webview may cache persistent data unless runtime policy prevents it; Electron must audit Chromium cache, logs, crash dumps, swap/hibernation and image persistence against NFR-1, with a persistence-sentinel test.
- Configured native plugins: deep-link, single-instance, dialog, updater. **Absent/not in scope:** tray, native menus, filesystem/shell/http/store plugins, notifications, `listen`/`emit`, `convertFileSrc`, renderer `window.open`, HTML5 drop handlers, localStorage/sessionStorage/cookies, and general-purpose filesystem/shell/network APIs. Do not infer new functionality from their absence.

## Build, packaging, signing, CI

- Renderer source is under `desktop/`; Vite dev server is strict port 1420, `fs.allow` permits parent access, output `desktop/dist`, assets are not inlined. Existing UI depends on assets/fonts and some shared files outside `desktop/`; qualify all resolution while writing build/cache outputs only under `electron/`. If alias cannot preserve read-only source, use a baseline-SHA-recorded Electron-owned frozen copy and patch only that copy.
- Tauri Rust uses stable toolchain, Cargo lockfile, bundled installers; `Cargo.toml` includes Tauri, keyring, reqwest, tokio, dialog/deep-link/single-instance/updater, ZIP and supporting crates. Do not reuse or change that dependency graph for Electron. Node port is I/O-bound (~1,300 Rust production lines); no sidecar.
- Existing `.github/workflows/desktop.yml` is push-scoped to `desktop/**`, `docs/api/openapi.json`, itself; Node 24 and stable Rust; npm tests/build, cargo tests/clippy, binary smoke, bundle secret scan on macOS/Windows/Linux. Existing release workflow is `v*`, builds macOS arm64/x64, Windows x64, Ubuntu 22.04; `tauri-action` uses updater signing secret and releases-repo token. Existing CI/release workflows remain byte-identical. Electron protection/parity/build/release workflows must be separately approved and isolated; use `electron-v*` tags, isolated credentials and outputs.
- Support matrix approved by the owner (2026-11-13): macOS 15+ arm64/x64, Windows 11 x64, Ubuntu 24.04 LTS x64, still conditioned on the selected Electron release's support window and on minimum/current runtime qualification, which has not been run.
- No paid Apple developer membership. Unsigned macOS Gatekeeper warnings/blocking are a release risk; no bypass recommendation. Manual updates do not establish package authenticity or OS trust. The release host is the owner's Thymeleaf download site (18.5), public behind a secret path (obscurity, not access control); no server or host name exists yet (OQ-M5). No certificates are used (internal-use app).

## Inventory-to-story coverage

| Surface | Proposed owner |
| --- | --- |
| Baseline guard, path isolation, screenshot/interaction harness and feasibility | 14.1–14.4 |
| Hardened shell, scheme/CSP, preload, Channel shim and closed command registry | 15.1–15.4 |
| Config/API validation, refresh, keychain/logout/session-only, PKCE/browser, deep link/single-instance/loopback, dirty state | 16.1–16.6 |
| Photo/drop upload engine, native drop lifecycle, attachment/avatar, ZIP export, image protocol, browser parity | 17.1–17.6 |
| Packaging, unsigned distribution/Gatekeeper, manual update exception, download site, upgrade/reinstall/rollback | 18.1–18.5 |
| Protected paths/allowlist CI, isolated build/test, OS qualification, isolated releases | 19.1–19.4 |
| Full-flow parity, startup/memory, opt-in pilot, rollback and separately approved retirement decision | 20.1–20.4 |

**Count: 33 stories** (4 + 4 + 6 + 6 + 5 + 4 + 4). Current browser-mocked tests and screenshots are not proof of native Electron/Tauri parity. Runtime, installer, OS keychain, dialogs, protocol, auth and packaged rollback evidence remains outstanding; no such checks were run for this documentation task.
