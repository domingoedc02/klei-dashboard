# Key custody

Losing every KEK copy loses all data. Nothing in the database or the object store can be read without a key kept outside them, and no one at Klei Bridal or Anthropic can recover it.

## What to keep, and where

| Secret | Environment variable | Rotation | Copy |
| --- | --- | --- | --- |
| Key-encryption keys (KEK) | `KLEI_KEK_<n>`, active one named by `KLEI_KEK_ACTIVE` | Yearly and on staff exit (steps below) | Offline, apart from the backups |
| Blind-index key | `KLEI_BIDX_KEY` | Not rotatable in this release | Offline, apart from the backups |
| Token signing key | `KLEI_JWT_KEY` | Not rotatable in this release | Offline, apart from the backups |
| Desktop updater signing key (minisign) | CI secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; public half in `tauri.conf.json` | Only for a compromise or a planned handover (below) | Offline escrow, next to the KEK copies |

Never put any of them in the repository, the image, a backup or a chat. Keep every KEK that a row still needs, until the status panel shows none.

**Holder:** ______________________ (fill in; OPEN QUESTION OQ-5, default: the studio owner, one printed or encrypted offline copy kept away from the server)

**Last checked that the offline copy opens:** ______________________

## Rotating the KEK

Four deploys, one step each. Reads keep working at every step. Generate the new key with `openssl rand -base64 32`.

1. Fill the next free slot `KLEI_KEK_<n+1>` in `infra/.env` (the compose file forwards `KLEI_KEK_1` to `KLEI_KEK_4`; blank slots are ignored; more slots mean one more line in `infra/docker-compose.yml`). Deploy. Both keys are accepted.
2. Set `KLEI_KEK_ACTIVE=<n+1>`. Deploy. New data is wrapped with the new key, old rows still open with the old one.
3. Sign in as an Admin, open Settings > Keys and press Re-wrap now. The panel shows progress and the result. Nothing is re-encrypted; only the wrapped data keys move. It is safe to run twice.
4. When the panel shows no rows at the old version, remove `KLEI_KEK_<n>` and deploy. The app refuses to start, naming the variable, if any row still needs a key it does not have; put the variable back and start again.

Store the new KEK offline before step 2. Keep the old one offline until step 4 has run and a backup taken after it has been restored once (see the backup story).

## If something goes wrong

- **Start fails with `missing_kek` and a variable name.** A row still needs that key. Put the variable back with the same value and deploy.
- **Re-wrap shows Failed.** Read the application log for the line `key re-wrap failed` (it names the exception class, never a key). Fix the cause and press Re-wrap now again; it resumes where it stopped.
- **Re-wrap is refused with a conflict.** Either the active key is not the highest configured one (do step 2), or another run is in progress (wait for it).

## Desktop updater signing key

Every installed app trusts one public key, compiled into it (`plugins.updater.pubkey`, with `requireSignedVersion`). The private half signs each release in CI.

- Generate once, offline: `npx tauri signer generate -w klei-updater.key`. Put the private key and its password into the CI secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; write the public key into `desktop/src-tauri/tauri.conf.json` before the first tagged release. Keep one offline escrow copy with the KEK copies.
- **Losing the private key strands every installed client**: no update can be signed that they accept, so every user reinstalls by hand from the install guide. Keep the escrow copy readable (add its check date to the line above).
- **Compromise or planned change**: ship one release signed by the old key that embeds the new public key; after clients have updated, sign with the new key only. If the old key is lost, this is not possible; see the previous point.
- The update address is one constant in `tauri.conf.json`. Moving the host means one release, signed by the old key, that points at the new address.
- `RELEASES_TOKEN` (write access to the public releases repo only) is separate from the updater key; rotate it in the repository settings at any time.
- Not set yet (operator): real updater key pair, releases repo owner and name. The config holds the placeholders `OWNER/RELEASES_REPO` and `REPLACE_WITH_UPDATER_PUBLIC_KEY`; the release workflow refuses to run with them.
