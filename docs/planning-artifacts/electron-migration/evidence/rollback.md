# Rollback rehearsal (story 20.4)

Status: NOT RUN. Human rehearsal on real machines, one per OS, timed. This file is the template; every cell is empty until someone runs it.

Rollback means: keep distributing the Tauri installers. No Tauri file is changed, so rollback needs no repository action. The preview has its own app id (`co.klei.bridal.electron.preview`), profile and credential entry, so the Tauri app is never touched by installing, using or removing it.

The reviewer records PASS, CONCERNS or FAIL. The owner decides cutover.

## Steps (per OS)

1. Preview in use: signed in, a Draft left unsent.
2. Stop the preview (quit the app).
3. Install the Tauri build made from the baseline commit `51949da2a0f8347c5f1f56fc5d87d8ada6e60643` (or start the installed one).
4. Open it, sign in.
5. Confirm business data and Drafts are intact (the data lives on the backend; a Draft lives in the app that held it, so the Tauri side shows its own).
6. Optional: remove the preview, its profile folder and its credential entry (`electron/INSTALL-PREVIEW.md`, "Removing the preview"). Never touch anything named `co.klei.bridal`.
7. The Tauri app shows the baseline screens at 1280x800 and 1100x700.

## Results

| OS | Machine and OS version | Step 1 to 7 completed | Time (min:s) stop to signed in on Tauri | Data and Drafts intact | Tauri screens match at both sizes | Preview fully removed | Verdict |
|---|---|---|---|---|---|---|---|
| macOS arm64 | | NOT RUN | | | | | NOT RUN |
| macOS x64 | | NOT RUN | | | | | NOT RUN |
| Windows 11 x64 | | NOT RUN | | | | | NOT RUN |
| Ubuntu 24.04 x64 | | NOT RUN | | | | | NOT RUN |

## Gate

14.1 gate after the rehearsal: `node electron/scripts/protected-paths.mjs`: ____

NOT RUN is not PASS. The MFR-8 rollback condition is met only when every row above is PASS.
