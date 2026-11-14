# Parity matrix (story 20.1)

Status: PARTIAL. Visual side run on macOS arm64 only. Every native row and every other OS is NOT RUN. NOT RUN is not PASS.

Verdict is recorded by the reviewer. Cutover is the owner's decision (`decisions/cutover-decision.md`), not filled here.

## Provenance

| Item | Value |
|---|---|
| Tauri baseline | `51949da2a0f8347c5f1f56fc5d87d8ada6e60643`; `desktop/` tree `2d4f575ad00986301baed409683a88b22a682ef4` at baseline and at this run |
| Note | Recorded at the first baseline. Story 21.5 moved the baseline to `463f89f901d2db71e6e2ce8300ea92e7bd128a5e` after Epic 21 changed `desktop/`; this run is not repeated against it. |
| Gate before and after | `node electron/scripts/protected-paths.mjs`: "protected paths unchanged", exit 0 |
| Harness | `electron/test/parity/harness.mjs` (`--side baseline`, `--side app`, `--renderer electron`), `compare.mjs` |
| Tolerance | zero differing pixels, zero geometry-only findings, zero copy differences |
| Host | macOS arm64 (Darwin 25.6.0), Electron 45.3.2, Node 24 |
| Sizes | 1440x900, 1280x800, 1100x700 (inner size verified per state; 1440x900 uses CDP emulation because the display caps the window height, recorded in `meta.json`) |
| Outputs | `electron/parity-out/` (git-ignored); nothing written under `docs/planning-artifacts/ui-parity/` |

Three captures are compared:

- `baseline`: original Tauri renderer, plain Chromium, command table mocked by the fixtures (the 14.2 baseline).
- `electron`: Electron renderer (`electron/build/renderer`) in plain Chromium, same mocks. Isolates renderer differences from shell differences.
- `app`: the built Electron app, real main process, real preload and IPC, against a loopback mock of the API. Sign-in goes through the real PKCE loopback flow; only `shell.openExternal` is stubbed (it plays the browser) and `klei-img` answers fixture SVGs.

## Visual results, macOS arm64

| Pair | Sizes | States compared | Missing in `app` | Different |
|---|---|---|---|---|
| `baseline` vs `app` | 3 | 69 each | 3 | 1 (`banner-update-ready`) |
| `electron` vs `app` | 3 | 69 each | 2 | 0 |

Identical result at all three sizes. Baseline has 72 states; the `electron` renderer run has 71 (it cannot capture `banner-update-failed`, see below).

### Differences

| State | Pixels | Copy | Cause | Verdict |
|---|---|---|---|---|
| `banner-update-ready` | 886 | "Version 1.2.0 is ready." / "Install and restart" becomes "Version 1.2.0 is available." / "Download update" | The one approved parity exception (18.3): manual download page replaces the signed in-app install | PASS (approved exception) |

### States not captured in `app`

| State | Reason | Covered by |
|---|---|---|
| `upload-error` | Needs the native file dialog | 17.1, `uploads.test.ts`; native row below |
| `signin-keychain_unavailable` | Needs a broken OS credential store | `keychain.test.ts`, `session-signin.test.ts`; native row below |
| `banner-update-failed` | Tauri signed-update install does not exist in Electron; the button opens the download page | 18.3, `update.test.ts` |

`banner-update-failed` is also missing from the `electron` renderer run (click target "Install and restart" no longer exists). That is the same exception, not a regression.

### Harness findings fixed during the run

- Window inner height 804 for 900: CDP emulation fallback.
- `addStyleTag` refused by the app CSP: `insertCSS` from main.
- `app.getVersion()` was Electron's own: app started by folder with a `0.0.0` package.json.
- `signin-no_access` and `signin-session_expired` showed the generic sign-in copy: the quiet reload consumed the one-shot failure. The failure is now switched on only for the final reload.

## Native rows (to be run by humans per OS, on a real Tauri build from the baseline SHA and a real Electron package)

Result is PASS, CONCERNS, FAIL or NOT RUN. Reuse 17.6 and 18.4 records where they exist.

| Row | macOS arm64 | macOS x64 | Windows 11 x64 | Ubuntu 24.04 x64 | Owning story |
|---|---|---|---|---|---|
| Sign-in (loopback) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 16.4 |
| Refresh after expiry | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 16.2 |
| Sign-out | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 16.3 |
| "Continue without saving" | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 16.3 |
| Photo upload (dialog) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.1 |
| Drag-and-drop upload | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.2 |
| Avatar | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.3 |
| Reply attachment | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.3 |
| Gown archive export (save dialog, cancel, partial removal) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.4 |
| Thumbnails and `klei-img` | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.5 |
| Clipboard copy | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.6 |
| `execCommand('insertText')` | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.6 |
| `beforeunload` guard | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.6 |
| Dirty-work guard on the Update button | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 18.3 |
| Manual update check | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 18.3 |
| Hash routing and reload | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 15.x |
| Window sizes (1280x800 default, 1100x700 minimum) | visual run only (see above) | NOT RUN | NOT RUN | NOT RUN | 15.1 |
| Keyboard focus order | NOT RUN | NOT RUN | NOT RUN | NOT RUN | 17.6 |
| Visual matrix on the OS | PASS (above) | NOT RUN | NOT RUN | NOT RUN | 14.2 |

## Reviewer verdict

Visual, macOS arm64: PASS with the one approved exception.
Overall: not decidable. Every native row and three of four OS targets are NOT RUN.
