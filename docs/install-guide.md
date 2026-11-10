# Klei Bridal: install and update guide

Audience: Staff and Admins installing the desktop app. Installers carry no operating-system signing certificate yet (PRD FR-43, Gate 2), so each system shows a warning on first launch. The steps below get past it. The warning is expected; it does not mean the file is damaged.

Download installers only from the studio's releases page (the address your Admin gives you). Do not use a copy that came by e-mail or chat.

## macOS (`.dmg`, Apple silicon or Intel)

1. Open the `.dmg` and drag **Klei Bridal** into **Applications**.
2. First launch: in Finder, right-click **Klei Bridal**, choose **Open**, then **Open** again in the dialog. Double-clicking shows "cannot be opened" instead.
3. If macOS still refuses, run once in Terminal: `xattr -d com.apple.quarantine "/Applications/Klei Bridal.app"` and open the app again.

Pick the right file: `aarch64` for M-series Macs, `x64` for Intel Macs (Apple menu, About This Mac).

## Windows (`.exe` setup or `.msi`)

1. Run the installer.
2. SmartScreen shows "Windows protected your PC": choose **More info**, then **Run anyway**.
3. Start **Klei Bridal** from the Start menu.

## Linux

- **AppImage (recommended, updates itself):** `chmod +x Klei-Bridal_*.AppImage`, then run it. Needs `libfuse2` on some distributions.
- **`.deb` (Debian, Ubuntu):** `sudo apt install ./klei-bridal_*.deb`. A `.deb` does not update itself; install the new `.deb` over the old one.

## Signing in

The app opens your browser for sign-in and returns through a `klei://` link. If your browser asks "Open Klei Bridal?", allow it. If nothing happens, check that the app is installed and run once, then sign in again.

## Updates

- The app looks for a new version when it opens and once every 24 hours. Settings, Preferences, **Check for updates** looks right away.
- When one is ready a bar shows "Version X is ready." Choose **Install and restart**, or **Later** (the bar returns at the next look).
- It will not install while you have unsent work (an unsent reply or an Upload batch in review). Finish or discard it, then try again.
- The check sends only the app version, your operating system and its architecture. It sends no name, e-mail or token.
- Every package is checked against the studio's update key before anything is replaced. If that check fails you see "The update couldn't be verified. Nothing was changed." and the installed version keeps working. Tell your Admin; do not install by other means.
- Auto-update works for Windows, macOS and the Linux AppImage. A `.deb` install is updated by hand.
- If updates ever stop working for everyone (the update key was lost), install the newest installer by hand once. Your sign-in and settings are kept.

## Uninstall

macOS: drag the app to the Bin. Windows: Settings, Apps. Linux: delete the AppImage or `sudo apt remove klei-bridal`. Signing out first removes the saved sign-in from the system keychain.
