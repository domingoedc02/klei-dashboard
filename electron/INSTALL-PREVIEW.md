# Klei Bridal Preview: pilot guide

For volunteers trying the Electron preview next to the Tauri app. Preview only. The guide for the Tauri app (`docs/install-guide.md`) is a different document and is not changed. Every step of the usual install and update is in `docs/install-guide-electron.md`; this page is the short version plus what a pilot needs.

## What this is

A trial of the same app on a different foundation. Screens, features and your studio's data are the same. The one difference you will see: when a newer version exists the button says **Download update** and opens the download page in your browser, instead of installing by itself.

The preview has its own name (**Klei Bridal Preview**), settings and saved sign-in. It does not touch the Tauri app. Keep using the Tauri app for real work as usual; use the preview alongside it for the period the owner set (default two weeks).

## Install

Download only from the page your Admin gave you. Pick the row for your computer:

| Computer | File ends with |
|---|---|
| Mac, Apple silicon | `-mac-arm64.dmg` |
| Mac, Intel | `-mac-x64.dmg` |
| Windows 11, 64-bit | `-win-x64.exe` |
| Ubuntu 24.04, 64-bit | `-linux-x64.AppImage` or `-linux-x64.deb` |

The preview is not signed, so your computer warns you the first time. That is expected. Do not turn off any protection.

- **macOS:** open the `.dmg`, drag the app into Applications, open it, choose **Done** on the warning, then **System Settings, Privacy & Security, Security, Open Anyway**, then **Open**.
- **Windows 11:** run the installer; on "Windows protected your PC" choose **More info**, then **Run anyway**.
- **Ubuntu:** allow the AppImage to run as a program and open it, or install the `.deb`.

Sign in again the first time. Your Tauri sign-in is not shared.

## Switching back

Close **Klei Bridal Preview** and open the Tauri app. Nothing else is needed: nothing in the Tauri app was changed, and nothing was moved or copied from it. Close the preview before you start work you cannot afford to have interrupted.

## Reporting a problem

Tell your Admin in writing, with: what you did, what you expected, what happened, your operating system and the preview version (shown on the download page row you installed). Stop the pilot and report at once if you see any of:

- business data lost or shown twice (a gown, photo, inquiry or reply missing or duplicated),
- you cannot sign in,
- the app does not start.

Never put client names, faces or messages in a report or screenshot. Crop or blur them first.

## Who sees what

- The app talks only to the studio's own backend, as the Tauri app does. Nothing is sent to the preview's makers, to analytics, or to any third party. There is no telemetry.
- The update check asks the studio's download page for the latest version number only.
- Your reports go to your Admin and no one else.
- The app keeps your sign-in token in the system credential store, plus ordinary application settings and graphics caches. It is built so that gown photos, inquiries and client details are not written to disk; this was checked on macOS only, so tell your Admin if you find otherwise.

## Removing the preview

Optional, after the pilot. Remove the app the usual way, then, if you want no trace:

| System | Delete this folder | Delete this saved sign-in |
|---|---|---|
| macOS | `~/Library/Application Support/Klei Bridal Preview` | Keychain Access, entry `co.klei.bridal.electron.preview` |
| Windows | `%APPDATA%\Klei Bridal Preview` | Credential Manager, Windows Credentials, entry containing `co.klei.bridal.electron.preview` |
| Ubuntu | `~/.config/Klei Bridal Preview` | Passwords and Keys (Seahorse), entry `co.klei.bridal.electron.preview` |

Do not delete anything named `co.klei.bridal` (without `.electron.preview`): that is the Tauri app's.
