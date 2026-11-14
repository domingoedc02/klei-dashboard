# Klei Bridal Preview: release checklist (Electron)

For the Electron preview only. `docs/release-checklist.md` belongs to the Tauri app and is not changed or appended to. Story 18.4.

Every row below is a real packaged app on a real machine. `electron/test/packaged-lifecycle.test.ts` only checks the package metadata and that the app starts and leaves the Tauri profile alone; it does not replace any step here. A step with no evidence is not PASS.

- Use a test account only. Never a personal or production credential, and never move a credential between the two apps.
- Each OS result is PASS, CONCERNS or FAIL with evidence, recorded by the reviewer. The owner alone decides cutover.
- The update stays manual: the app only opens the download page. It never downloads, installs or restarts anything.

## Targets

| Target | Artifact | Machine |
|---|---|---|
| macOS arm64 | `klei-bridal-preview-<version>-mac-arm64.dmg` | macOS 15 or later, Apple silicon |
| macOS x64 | `klei-bridal-preview-<version>-mac-x64.dmg` | macOS 15 or later, Intel |
| Windows x64 | `klei-bridal-preview-<version>-win-x64.exe` | Windows 11 |
| Linux AppImage | `klei-bridal-preview-<version>-linux-x64.AppImage` | Not a release target (owner scope 2026-11-15); skip |
| Linux deb | `klei-bridal-preview-<version>-linux-x64.deb` | Not a release target (owner scope 2026-11-15); skip |

## Identities (the two apps must never share these)

| | Tauri app (read-only) | Electron preview |
|---|---|---|
| App id | `co.klei.bridal` | `co.klei.bridal.electron.preview` |
| Credential store entry | service `co.klei.bridal`, account `refresh-token` | service `co.klei.bridal.electron.preview`, account `refresh-token` |
| Profile folder | `co.klei.bridal` under the OS app-data folder, if present | `Klei Bridal Preview` under the OS app-data folder |

Profile locations: macOS `~/Library/Application Support/`, Windows `%APPDATA%\`, Linux `~/.config/` (Electron) and `~/.local/share/` (Tauri). Record what you see; do not assume.

## Steps, per target

Before: note the OS version and architecture, compute the artifact SHA-256 (`shasum -a 256`, `Get-FileHash`, `sha256sum`) and compare it with the download page. If the Tauri app is installed, list its profile folder and note whether its credential entry exists. Do not open or change either.

1. **Fresh install.** Follow `docs/install-guide-electron.md`. Record every prompt shown at first launch word for word, and whether the guide's steps got past it. Launch succeeds, window opens at 1280x800.
2. **Sign in** with the test account. Confirm the credential entry appears under the Electron service name only, and the Tauri entry is unchanged.
3. **Retention.** Quit and reopen: still signed in.
4. **Manual update.** Publish a newer version to the download page. In the app the banner reads "Version X is available." with **Download update**. With an unsent draft the button shows "You have unsent work. Finish or discard it first." and opens nothing. With no draft it opens the download page in the browser and the app keeps running. Install the newer file over the old one by hand; record any warning that returns. Still signed in afterwards.
5. **Reinstall** the same version over itself. Still signed in.
6. **Sign out.** Only the Electron credential entry is removed. The Tauri entry and profile are unchanged.
7. **Rollback.** Install the previous Electron installer over the newer one, or remove the preview and use the Tauri app. Record what the older build does with the newer profile (starts, signed in, refuses) and confirm the Tauri app still launches with its own profile and credential.
8. **Uninstall.** Record what remains: profile folder, credential entry, shortcuts, `.deb` residue. Claim nothing is removed unless you looked.

## Results log

One row per target per run. Evidence is a file in the release record (screenshots, command output), not a description.

| Target | OS and arch | Version | Artifact SHA-256 | Fresh install | Warnings seen | Manual update | Credential retention | Profile separation | Uninstall cleanup | Rollback | Result | Evidence | Date | Operator |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| (none yet) | | | | | | | | | | | | | | |

## Residual data

Anything left behind after uninstall (step 8) is listed here with the OS, and the owner decides whether it is acceptable. NSIS keeps the profile on uninstall (`deleteAppDataOnUninstall: false`).

| OS | Left behind | Owner decision |
|---|---|---|
| (none yet) | | |
