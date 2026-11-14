# Klei Bridal Preview: install and update guide

Audience: Staff and Admins installing the Electron preview of the desktop app. This guide is only for the preview. The existing guide `docs/install-guide.md` describes the Tauri app and is not changed.

The preview installers carry no operating-system signing certificate and are not notarized. Your computer will warn you the first time you open the app. The warning is expected; the steps below are the ones the operating system itself offers. Do not turn off any protection, and do not run a file you did not download from the studio's download page.

## Where to download

Use only the download page your Admin gave you. It lists every version newest first, marked **Preview**. Pick the row for your computer:

| Computer | Row to pick | File ends with |
|---|---|---|
| Mac, Apple silicon (M1 or later) | macOS, arm64 | `-mac-arm64.dmg` |
| Mac, Intel | macOS, x64 | `-mac-x64.dmg` |
| Windows 11, 64-bit | Windows, x64 | `-win-x64.exe` |
| Ubuntu 24.04, 64-bit | Linux, x64 | `-linux-x64.AppImage` or `-linux-x64.deb` |

Supported: macOS 15 or later, Windows 11, Ubuntu 24.04. Other versions are not tested.

The preview installs next to the Tauri app and does not touch it. It has its own name (**Klei Bridal Preview**), its own settings and its own saved sign-in. You sign in again the first time.

## First launch

### macOS

1. Open the `.dmg` and drag **Klei Bridal Preview** into **Applications**.
2. Open it from Applications. macOS says it cannot verify the app. Choose **Done**.
3. Open **System Settings**, **Privacy & Security**, scroll to **Security**, and choose **Open Anyway** next to the message about Klei Bridal Preview. Enter your login password if asked, then choose **Open**.

On older macOS versions you can instead right-click the app in Finder, choose **Open**, then **Open** again. macOS 15 and later no longer offers that route, so use the Privacy & Security step there. You only do this once per installed copy.

### Windows 11

1. Run the installer.
2. If a blue "Windows protected your PC" window appears, choose **More info**, then **Run anyway**.

### Ubuntu 24.04

- **AppImage:** in Files, open the file's properties and allow it to run as a program (or run `chmod +x` on it), then open it. Some systems also need `libfuse2`.
- **.deb:** install it with the software installer. A `.deb` does not update itself.

## Updating

The app checks whether a newer version exists. When one does, the **Download update** button opens the download page in your browser. The app does not download, check or install anything itself, and it does not restart.

1. Finish or discard unsent work first. The button refuses while there is unsent work.
2. Download the newer file for your computer from the page and install it over the old one, the same way as the first time.
3. If the app asks you to sign in again, sign in.

An update installed by hand is a new unsigned file, so the first-launch warning can appear again. Updating does not remove it.

## Checking a download (optional)

Each file on the download page shows a SHA-256 value. Comparing it with your downloaded file confirms the file was not damaged or changed on the way from the page to you.

- macOS: `shasum -a 256 <file>`
- Windows (PowerShell): `Get-FileHash <file> -Algorithm SHA256`
- Ubuntu: `sha256sum <file>`

The value is published by the same page that serves the file. It proves the file is the one the page lists. It does not prove who made it, and it does not replace the operating-system warning. If the values differ, do not open the file; download it again and tell your Admin.

## For the release operator

1. Build each installer on a runner of its own operating system and architecture (the credential store module is chosen at install time and is missing when built across).
2. Generate the SHA-256 of every installer (`shasum -a 256`), and record the exact size.
3. Publish the five installers and `release.json` (fields `version`, `pubDate`, `channel: "preview"`, and per file `name`, `os`, `arch`, `kind`, `size`, `sha256`) into one version folder of the download site's data directory, `release.json` last. The site shows the SHA-256 beside each file. Nothing else publishes a checksum.
4. On a real machine of each kind, record the operating-system version, the file's SHA-256 and the exact prompts seen at first launch, and attach them to the release record. A warning is never described as fixed by an update.
