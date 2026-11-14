# Spike 3: protocol and instance coexistence

Date 2026-11-14. Status: **partial**.

## Question
Can the preview build run beside the Tauri app without sharing the `klei://` handler, the single-instance lock, the profile or the credential entry?

## Method
Three Electron 45.3.2 processes: A (name `klei-preview`, userData `s1`), B (name `klei-tauri-like`, userData `s2`) and C (same name and userData as A), each calling `app.requestSingleInstanceLock()`. Credential isolation from spike 1. No installed Tauri app was found in `/Applications` or `~/Library/Application Support`, so it was not run.

## Result

| Check | Result |
|---|---|
| A takes the lock | true |
| B (different app name and userData) takes its own lock while A runs | true |
| C (same name and userData as A) is refused | false (correct) |
| Preview credential entry differs from the Tauri one | yes: `co.klei.bridal.electron.preview` vs `co.klei.bridal` (spike 1) |
| Preview registers no `klei://` handler | by construction only: the app never calls `app.setAsDefaultProtocolClient`. No build exists yet to inspect. |
| Loopback sign-in completes while Tauri is running | not verified (needs the backend and 16.4) |
| Profile directories separate | by construction: `userData` is derived from the preview app name |

## Decision
Preview identity: app id `co.klei.bridal.electron.preview`, its own `userData`, its own keychain service, **no `klei://` registration**, loopback sign-in only. 16.5 must keep the deep link behind an explicit later switch and a test that the preview never registers it. B differed from A in both name and userData, and C matched A in both, so the test does not show which of the two the lock keys on. Give the preview a different name and a different userData, and do not rely on either alone.

## Residual risk
Real coexistence with the installed Tauri app and a live sign-in remain to be run in 16.4 and 16.5. Windows registry and Linux `.desktop` handler registration are not verified.

## Update (16.5)
Preview sign-in uses `loopbackRedirect` in `electron/src/main/auth.ts`; `electron/test/contract.test.ts` asserts main never calls `setAsDefaultProtocolClient` or `removeAsDefaultProtocolClient` and `index.ts` never attaches the deep-link handler. `loopback.test.ts` shows the listener binds `127.0.0.1` at port 1024 or above and closes after one callback. Still open: loopback sign-in beside a running Tauri app with a live backend (20.1), and the Windows registry and Linux `.desktop` checks.
