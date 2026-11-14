# Baseline

Migration baseline: `8e2eca27f91f5bfcd7a146961d603117bf8a597b`, "21.6: an unreadable describe answer leaves the Group undescribed instead of failing the batch, story done". It stays the baseline even if `main` moves.

Previous baselines: `463f89f901d2db71e6e2ce8300ea92e7bd128a5e` ("21.1-21.4, 21.6: fixed app frame and footers, Review save bar, Viewer lightbox, group combobox, no-limit upload"), replaced on 2026-11-15 by owner decision (EJ Domingo, Story 21.5 pattern) because the large-photo pixel cap (Story 21.7) changed `desktop/` and `backend/`; and `51949da2a0f8347c5f1f56fc5d87d8ada6e60643` ("13.8: Upload Review: select, Move, Merge, Split"), replaced on 2026-11-14 for the same reason by Stories 21.1 to 21.6. Work lives on `electron-migration`.

## Protected paths

`desktop`, `backend`, `infra`, `prototype`, `docs/api`, `docs/install-guide.md`, `docs/release-checklist.md`, `.github/workflows`.

Allowed additions: `electron/`, `docs/`, and new `.github/workflows/electron*.yml`.

## Bridge commands (nine)

Source: `desktop/src-tauri/src/commands.rs`. Frontend call site: `desktop/src/bridge.ts`. Closed-set test: `desktop/src-tauri/tests/contract.rs`.

`api_request`, `sign_in`, `sign_out`, `session_only`, `set_dirty`, `check_update`, `install_update`, `upload_files`, `export_gowns`.

## Gate

    node electron/scripts/protected-paths.mjs

Exit 0 prints `protected paths unchanged`. Exit 1 lists each path with its status letter. The script runs these two commands and applies the allow rule:

    git diff --name-status 8e2eca27f91f5bfcd7a146961d603117bf8a597b -- desktop backend infra prototype docs/api docs/install-guide.md docs/release-checklist.md .github/workflows
    git status --porcelain --untracked-files=all -- desktop backend infra prototype docs/api docs/install-guide.md docs/release-checklist.md .github/workflows

Manual form, valid only while no `electron*.yml` is committed:

    git diff --exit-code 8e2eca27f91f5bfcd7a146961d603117bf8a597b -- desktop backend infra prototype docs/api docs/install-guide.md docs/release-checklist.md .github/workflows
    git status --porcelain --untracked-files=all -- desktop backend infra prototype docs/api .github/workflows

The second command must print nothing, except `?? .github/workflows/electron*.yml`.

Test (no `git` is run): `node --test electron/test/protected-paths.test.ts`

## Protection workflow (19.1)

`.github/workflows/electron-protect.yml` runs the gate above on every `pull_request` and every `push`, with no path, branch or tag filter, so a filter cannot hide an edit to the protected Tauri app. It uses only `actions/checkout` and `actions/setup-node` at full commit SHAs, `permissions: contents: read`, no secrets.

Owner action (a workflow cannot enforce its own existence): in the repository settings add a branch protection rule or ruleset for `main` that requires the status check `protect` (workflow `electron-protect`) and requires review for `.github/workflows/electron-protect.yml` and `electron/scripts/protected-paths.mjs` (CODEOWNERS or the ruleset "restrict file paths"). Until set, a pull request can rewrite the check that guards it.

Static test: `node --test electron/test/workflows.test.ts`.

## Electron runtime (15.1)

Web check 2026-11-14: Electron 45.3.2 is npm latest and in the three-newest-majors support window (OQ-M1).

| Item | Value |
|---|---|
| Electron | 45.3.2 (pinned, `electron/package-lock.json`) |
| Node in main | 24.22.2 |
| Chromium | 156.0.8078.100 |
| Node ABI (`process.versions.modules`) | 150 |
| TypeScript | 5.9.3, `@types/node` 24.19.2 (same as `desktop/`) |
| Test runner | `node --test` with type stripping; no Vitest here |

Main is compiled to CommonJS (`npm run build`, `build/main/`). Electron 45.3.2 hangs on ESM main with top-level `await app.whenReady()`; main uses `.then`.

## Identity

App id `co.klei.bridal.electron.preview`, product name "Klei Bridal Preview", `userData` = `<appData>/Klei Bridal Preview`, set before `ready`. The single-instance lock lives in `userData`, so an installed Tauri app (`co.klei.bridal`) starts independently. No `klei://` claim.

## Build-time values

`KLEI_API_URL`, `KLEI_AUTH_URL`: read by `npm run build` into `build/main/build-config.json`; main reads it (16.1), the renderer never sees it. `KLEI_RELEASE=1` with either missing fails the build. Without `KLEI_RELEASE`, defaults are `http://127.0.0.1:8080` and `http://127.0.0.1:8081`, as in Tauri debug builds.

## Smoke mode

`KLEI_SMOKE=1`, same contract as `desktop/src-tauri/src/lib.rs`: in-memory credential (16.3), first `api_request` answers signed out (16.1), exit code 1 after 60 s. Used by the CI smoke launch (19.2, 19.3). 15.1 implements the exit; the rest lands in 16.x.

