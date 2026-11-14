# Publishing an Electron preview release (story 19.4)

Separate from the Tauri release (`docs/release-checklist.md`, `release.yml`, `v*` tags). Nothing here touches `RELEASES_*`, `TAURI_SIGNING_*` or a GitHub release. The owner's checklist for qualification is `docs/release-checklist-electron.md`.

## One-time setup (owner)

| Where | Name | Value |
|---|---|---|
| GitHub environment `electron-release` | required reviewers | the owner (this is the approval gate) |
| environment secret | `ELECTRON_DOWNLOAD_BASE_URL` | `https://<subdomain>/<43+ char token>`, the same value the download site is configured with |
| environment secret | `ELECTRON_DEPLOY_HOST` | the site's SSH host name |
| environment secret | `ELECTRON_DEPLOY_USER` | a user that can write only the download data folder |
| environment secret | `ELECTRON_DEPLOY_KEY` | private key of a deploy-only key pair |
| environment secret | `ELECTRON_DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan <host>` taken from a trusted network, then compared with the server's own `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` |
| environment variable | `ELECTRON_DEPLOY_PATH` | absolute path of the download site's data folder (`KLEI_DOWNLOAD_DATA_DIR` on the server) |
| environment variables | `KLEI_API_URL`, `KLEI_AUTH_URL` | production backend addresses (the same values the Tauri release reads) |

The download token never goes in the repository, in `.env.example`, in chat or in a log.

## Release

1. Set `electron/package.json` `version` to `X.Y.Z` and merge it.
2. `git tag electron-vX.Y.Z && git push origin electron-vX.Y.Z`.
3. Approve the `build` jobs (one approval for the four runners) and later the `publish` job.

What runs, in order:

1. `verify`: the tag must be `electron-v<semver>` and equal the package version.
2. `test`: type check, tests and the skip check on macOS, Windows and Linux.
3. `build` x4 (macOS arm64, macOS x64, Windows x64, Linux x64): first checks the site is reachable, the host key matches and the version does not exist yet; then builds with `KLEI_RELEASE=1` and the real URL, inspects the package, scans for secrets, launches the app from each installer, and sends its installers into `<data>/.X.Y.Z.part/`.
4. `publish`: builds `release.json` from exactly five installers, scans it, checks the names and the SHA-256 of every uploaded file on the site, uploads `release.json` last, and renames the folder to `X.Y.Z`.

The site lists a version only when its folder is named like a version, so a half-uploaded `.X.Y.Z.part` is never shown. Installers are not uploaded to GitHub: they contain the real download URL and this repository is public. Only the file names, sizes and hashes travel between jobs.

## Failure and retry

- The version folder already exists: nothing is changed. Versions are never overwritten. Bump the version and tag again.
- A job failed after some installers were sent: the `.X.Y.Z.part` folder stays hidden. Delete it on the server (`rm -r <data>/.X.Y.Z.part`), then re-run the failed jobs or tag a new version.
- Wrong version published: remove its folder on the server by hand (the site then lists the previous one). There is no automated rollback or unpublish.

## Not verified

No hosted run has happened. The first tag push is the evidence for the workflow, the SSH steps, the Windows installer path and the macOS x64 runner. `deploy.sh` is tested here only against recorded `ssh`/`scp`/`rsync` calls; the Windows runner copies with `scp` (no `rsync`) and the remote side needs `sha256sum` and `mv`.
