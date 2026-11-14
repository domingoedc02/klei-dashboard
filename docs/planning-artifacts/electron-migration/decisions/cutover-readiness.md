# Cutover readiness (story 20.4)

Reviewer record. Verdict values: PASS, CONCERNS, FAIL, NOT RUN. NOT RUN is not PASS. This is evidence, not a decision: the owner alone decides cutover, in `cutover-decision.md`.

Written 2026-11-14 against branch `electron-migration`. Documentation and local readiness only; no hosted run, no second OS, no pilot.

## Verdict per OS

| OS | Visual parity | Native parity | Cold start and idle memory | Install and update qualification | Rollback rehearsed | Overall |
|---|---|---|---|---|---|---|
| macOS arm64 | PASS ([parity-matrix.md](../evidence/parity-matrix.md), 69 states x 3 sizes, one approved exception) | NOT RUN | CONCERNS (inside limits; warm cache, laptop; [performance.md](../evidence/performance.md)) | CONCERNS (18.4 partial; Gatekeeper route on macOS 15 unconfirmed, spike 2) | NOT RUN | NOT READY |
| macOS x64 | NOT RUN | NOT RUN | NOT RUN | NOT RUN (never built locally) | NOT RUN | NOT READY |
| Windows 11 x64 | NOT RUN | NOT RUN | NOT RUN | NOT RUN (never built locally) | NOT RUN | NOT READY |
| Ubuntu 24.04 x64 | NOT RUN | NOT RUN | NOT RUN | NOT RUN (never built locally) | NOT RUN | NOT READY |

## MFR-8 gate checklist

| Condition | State | Evidence |
|---|---|---|
| All stories done | NOT MET: 14.3, 18.2 to 18.5, 19.1 to 19.4, 20.1 to 20.4 are `partial` or open | `docs/stories/`, Dev Agent Records |
| Parity matrix green on every OS | NOT MET: macOS arm64 visual only | `evidence/parity-matrix.md` |
| NFR-2 start-up <= 3 s and idle <= 300 MB, whole process tree, measured | NOT MET: one machine, warm cache; Windows and Linux readers never run | `evidence/performance.md` |
| Rollback rehearsed | NOT MET | `evidence/rollback.md` |
| Pilot (owner may waive) | NOT RUN | `evidence/pilot.md` |
| Protected paths unchanged (14.1 gate) | MET at the last commit: "protected paths unchanged" | `node electron/scripts/protected-paths.mjs` |

## Open FAIL and CONCERNS

| Id | Kind | Item | Owning story |
|---|---|---|---|
| C1 | CONCERNS | Windows NSIS, Linux AppImage and deb, macOS x64 packages never built or installed locally; first hosted runs of 19.2 to 19.4 not done | 18.1, 19.3 |
| C2 | CONCERNS | macOS 15 Gatekeeper "Open Anyway" route unconfirmed on a real downloaded file | 18.2, spike 2 |
| C3 | CONCERNS | Playwright-Electron under xvfb with the setuid sandbox; `dpkg -L` lookup; `macos-15-intel` folder name `mac`; npm install-script warning unreviewed | 19.2, 19.3 |
| C4 | CONCERNS | Download site: HTTPS subdomain, Dokploy values, secret-path token and deploy secrets are owner actions, none confirmed done (OQ-M5); a leaked deploy key can publish a build, so the required-reviewer environment and a deploy user limited to the data folder are the control | 18.5, 19.4 |
| C5 | CONCERNS | Native flows (dialogs, drag-and-drop, deep link, broken keychain, export save dialog, clipboard, focus order) have scripted tests but no per-OS human run | 17.x, 20.1 |
| C6 | CONCERNS | Idle memory and cold start only on an Apple M5 with a warm cache; `purge` run and mid-range hardware missing | 20.2 |
| C7 | CONCERNS | Protection workflow is not yet a required status check (repository setting, owner) | 19.1 |
| C8 | CONCERNS | No-disk-content audit (spike 4) done on macOS only; shader caches remain on disk | 14.3 |
| none | FAIL | No open FAIL | |

## Approved exceptions (not regressions)

- Update button opens the download page; no in-app install, no automatic restart (18.3). The `banner-update-ready` and `banner-update-failed` states differ by design.
- Preview never registers `klei://`; sign-in returns over loopback (OQ-M4).

## Reviewer conclusion

Not ready for a cutover decision. No FAIL is open, but the evidence covers one OS visually and nothing natively. Recommend: run 19.2 to 19.4 on GitHub, then 20.1 native rows, 20.2 and 20.4 on each OS, before the owner considers deciding.
