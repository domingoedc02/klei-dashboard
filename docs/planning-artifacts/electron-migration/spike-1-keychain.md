# Spike 1: OS credential store

Date 2026-11-14. Code: `electron/spikes/1-keychain/` (throwaway).

## Question
Can a Node library in Electron main give the same credential contract as `desktop/src-tauri/src/keychain.rs` (service + account `refresh-token`, missing = none, errors fail closed)?

## Method
`@napi-rs/keyring` 2.1.2 (npm modified 2026-10-19), `AsyncEntry`, service `co.klei.bridal.electron.preview`, account `refresh-token`. Run once under Node 24.22.1 (`check.mjs`) and once inside Electron 45.3.2 main (`main.mjs`, service suffix `.spike`).

## Result

| Check | macOS 26.6 arm64 | Windows 11 | Ubuntu 24.04 | macOS x64 |
|---|---|---|---|---|
| missing entry returns `null` | pass | not verified | not verified | not verified |
| store, load | pass | not verified | not verified | not verified |
| overwrite (4006-char value) | pass | not verified | not verified | not verified |
| second `AsyncEntry` instance sees the value | pass | not verified | not verified | not verified |
| other service name isolated | pass | not verified | not verified | not verified |
| delete; load after delete is `null`; delete of missing returns `false` | pass | not verified | not verified | not verified |
| same calls inside Electron main | pass (`[null,"tok-e",null]`) | not verified | not verified | not verified |
| locked or denied store surfaces as an error | not verified | not verified | not verified | not verified |
| packaged, unsigned app | not verified | not verified | not verified | not verified |

The Tauri entry `co.klei.bridal` exists on this machine's login keychain. It was found by attribute only, never read, and never written. The preview entry is a different service, so the two cannot collide.

`safeStorage` plus a file was not evaluated: the library above passed the checks it would have had to pass, and it keeps the secret in the OS store with no file.

## Decision
`@napi-rs/keyring` 2.1.2 for the credential adapter in 16.3, service `co.klei.bridal.electron.preview`, account `refresh-token`. Wrap it so a thrown error is a `{kind:"keychain"}` failure and never falls back to a file or memory silently (memory mode stays an explicit user choice, as in `SwitchKeychain`).

## Residual risk
- Prebuilt binaries arrive as per-platform optional packages (`@napi-rs/keyring-darwin-arm64` here). 18.1 must bundle the right one per target arch and unpack the `.node` file from asar.
- Windows, Linux and macOS x64 are unverified; 16.3 stays blocked for those OS until a run records them. Linux needs a running Secret Service (gnome-keyring); a headless session without it must produce the fail-closed error, not a hang. Check that explicitly.
- macOS keychain access control is tied to the code signature of the app that created the item. With ad-hoc signing each build has a different identity, so a manually installed newer build may trigger a keychain prompt or fail to read the old entry. Not tested here; 18.2 must test replace-by-newer-build.
