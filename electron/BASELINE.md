# Baseline

Migration baseline: `51949da2a0f8347c5f1f56fc5d87d8ada6e60643`, "13.8: Upload Review: select, Move, Merge, Split". It stays the baseline even if `main` moves. Work lives on `electron-migration`.

## Protected paths

`desktop`, `backend`, `infra`, `prototype`, `docs/api`, `docs/install-guide.md`, `docs/release-checklist.md`, `.github/workflows`.

Allowed additions: `electron/`, `docs/`, and new `.github/workflows/electron*.yml`.

## Bridge commands (nine)

Source: `desktop/src-tauri/src/commands.rs`. Frontend call site: `desktop/src/bridge.ts`. Closed-set test: `desktop/src-tauri/tests/contract.rs`.

`api_request`, `sign_in`, `sign_out`, `session_only`, `set_dirty`, `check_update`, `install_update`, `upload_files`, `export_gowns`.

## Gate

    node electron/scripts/protected-paths.mjs

Exit 0 prints `protected paths unchanged`. Exit 1 lists each path with its status letter. The script runs these two commands and applies the allow rule:

    git diff --name-status 51949da2a0f8347c5f1f56fc5d87d8ada6e60643 -- desktop backend infra prototype docs/api docs/install-guide.md docs/release-checklist.md .github/workflows
    git status --porcelain --untracked-files=all -- desktop backend infra prototype docs/api docs/install-guide.md docs/release-checklist.md .github/workflows

Manual form, valid only while no `electron*.yml` is committed:

    git diff --exit-code 51949da2a0f8347c5f1f56fc5d87d8ada6e60643 -- desktop backend infra prototype docs/api docs/install-guide.md docs/release-checklist.md .github/workflows
    git status --porcelain --untracked-files=all -- desktop backend infra prototype docs/api .github/workflows

The second command must print nothing, except `?? .github/workflows/electron*.yml`.

Test (no `git` is run): `node --test electron/test/protected-paths.test.ts`
