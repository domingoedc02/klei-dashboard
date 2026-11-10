# Release checklist

Run for every tag `v*`. CI (`.github/workflows/release.yml`) builds, signs the updater packages and uploads to the releases repo; the steps marked **manual** need a real machine because no CI runner can click a browser or an installer (architecture §9.4, spike S-3).

## Before tagging

1. `version` in `desktop/src-tauri/tauri.conf.json` equals the tag without `v` (CI refuses a mismatch).
2. `plugins.updater.endpoints` and `pubkey` are real, not `OWNER/RELEASES_REPO` or `REPLACE_WITH_UPDATER_PUBLIC_KEY` (CI refuses placeholders).
3. Repository: secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `RELEASES_TOKEN` (write access to the releases repo only); variables `RELEASES_OWNER`, `RELEASES_REPO`, `KLEI_API_URL`, `KLEI_AUTH_URL`.
4. Green on the same commit: `cd backend && ./mvnw verify`; `cd desktop && npm test && (cd src-tauri && cargo test)`; compose smoke (`infra/ci/smoke.sh`).
5. `infra/ci/perf.sh` passes (PR gate). Run `infra/ci/perf.sh --scale full` by hand when the release touches queries, indexes or search.
6. Backups: `infra/ops/backup.sh` ran in the last 24 h with exit 0 (RPO), and the **restore drill** in `infra/ops/restore.md` was run before the first go-live and again after any change of backup destination or key custody. Its dated result line is in that file.

## After CI finishes

7. Releases repo shows: `.dmg` (aarch64, x64), Windows `.exe`/`.msi`, `.AppImage`, `.deb`, a `.sig` next to each updater package, and `latest.json` listing `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, `linux-x86_64`.
8. `latest.json` `version` equals the tag; each `signature` is non-empty; each `url` opens.

## Per operating system (manual, once per release; N-1 to N)

Repeat on macOS, Windows, Linux (AppImage). Record result and date at the bottom of this file.

9. Install version N-1 from the installer, following `docs/install-guide.md` (Gatekeeper / SmartScreen path works as written).
10. Sign in. Open a `klei://` link from the browser (sign-in return): app comes to the front and lands signed in.
11. Publish N. In N-1 choose Settings, Preferences, **Check for updates**: bar reads "Version N is ready."
12. **Install and restart**: app restarts on N (check the version in the About line / installer record).
13. Still signed in after the restart (refresh token in the system keychain still reads); no second sign-in.
14. With an unsent reply in a draft, **Install and restart** shows "You have unsent work. Finish or discard it first." and installs nothing.
15. Tamper check once per signing-key change: a package with a wrong signature gives "The update couldn't be verified. Nothing was changed."
16. Linux `.deb`: installs, launches; confirm no self-update is promised in the UI copy.

17. Cold start: from launch to a usable window with the stored session, under 3 s on the reference machine (record seconds). Idle memory after 10 minutes on the Dashboard: under 300 MB (record MB from Activity Monitor, Task Manager or `ps`). NFR-2; no CI runner measures a real window, so there is no gate until three baselines exist.

## If something fails

- Pull the release (mark the GitHub release draft); `latest/download/latest.json` then points at the previous release.
- Never re-sign an already published version number; publish N+1.

## Results log

| Version | Date | macOS | Windows | Linux | Cold start s / idle MB | Who |
|---|---|---|---|---|---|---|
| (none yet) | | | | | | |
