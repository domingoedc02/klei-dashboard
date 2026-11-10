# Operations

Losing every KEK copy loses all data. Nothing in the database, a backup or the object store can be read without a key kept outside them; nobody can recover it.

Assumptions: containers run on Dokploy from `infra/docker-compose.yml`; one workspace; RPO 24 h, RTO 4 h (architecture §9.3). OPEN QUESTION (operator): Dokploy's scheduler for compose apps is unverified, host cron works the same way; backup destination and offline-key holder (OQ-5) are the operator's to name.

## Environment variables

Names and defaults live in `infra/.env.example`; `infra/ci/gen-keys.sh` prints fresh secrets. Secrets have no default: compose stops and names the variable. In production give a secret as `<NAME>_FILE`. The backend stops at start and names the variable, never a value, when one is missing, malformed, duplicated or wrong (`missing_variable`, `malformed_variable`, `duplicate_secret`, `missing_kek`, `wrong_kek`).

| Group | Variables |
|---|---|
| Database | `KLEI_DB_NAME`, `KLEI_DB_USER`, `KLEI_DB_PASSWORD` |
| Object store | `KLEI_S3_ACCESS_KEY`, `KLEI_S3_SECRET_KEY`, `KLEI_S3_BUCKET` |
| Keys | `KLEI_KEK_1..4`, `KLEI_KEK_ACTIVE`, `KLEI_BIDX_KEY`, `KLEI_JWT_KEY` |
| First Admin | `KLEI_BOOTSTRAP_ADMIN_EMAIL`, `KLEI_BOOTSTRAP_ADMIN_PASSWORD` (read only while no Admin exists) |
| Public addresses | `KLEI_API_BASE_URL`, `KLEI_AUTH_BASE_URL`, `KLEI_TRUSTED_PROXY_HOPS` |
| Mail | `KLEI_SMTP_*`, `KLEI_MAIL_FROM` (production: a real relay with `KLEI_SMTP_REQUIRE_TLS=true`) |
| Backup | `KLEI_BACKUP_TARGET` (no default; read by `infra/ops/backup.sh` only, not by the app) |

The AI provider key is never an environment variable: an Admin types it into Settings, AI, and it is stored encrypted.

## Key custody

See `infra/ops/key-custody.md`. KEKs, `KLEI_BIDX_KEY` and `KLEI_JWT_KEY` live offline, apart from the backups. Rotate a KEK yearly and when staff with access leave: Settings, Keys, then the steps in that file. Keep every KEK that a row still needs.

## Deploy

1. Back up first (`infra/ops/backup.sh`) when the release has a migration.
2. Stop the backend, then start the new image. Deploy is stop then start: migrations (Flyway) run once at start and are forward-only.
3. Check `GET /health/ready` and sign in.

Rollback: migrations are forward-only, so rolling back is a restore of the backup taken in step 1 plus the previous image and the previous environment variables (`infra/ops/restore.md`). Without a backup there is no rollback past a migration.

## Backup schedule

`infra/ops/backup.sh` writes `pg_dump` first, then copies the bucket, into a new folder under `$KLEI_BACKUP_TARGET`, and ends with an integrity report (stored-object rows whose object is missing). Exit 0 complete; 1 a step failed; 3 written but an object is missing.

- Run it once a day from Dokploy's scheduler or host cron, for example `17 2 * * * KLEI_BACKUP_TARGET=/mnt/klei-backup /path/to/infra/ops/backup.sh`.
- The destination must be outside the Dokploy host. Everything written is ciphertext; keys are never written.
- Alert on a non-zero exit. A backup older than 24 h breaks the RPO.
- Pruning old backup folders is the operator's job (OPEN QUESTION: retention).

## Restore drill

Run `infra/ops/restore.md` once before go-live, then after any change of backup destination or key custody, and write the dated result line there. A backup that was never restored is not a backup.

## Tuning grouping with your own photos

Put labelled photos in `<gown-label>/<photo>.jpg` folders (at least 5 gowns, 3 photos each, outside the repository). Export `KLEI_EMBED_URL`, `KLEI_EMBED_KEY` and `KLEI_EMBED_MODEL` in your shell (the embeddings address and key only, never the chat gateway's), then run `uv run infra/eval/embed.py <folder> --out ~/klei-eval/gowns.vectors.json` and `cd backend && ./mvnw -pl app -am test -Dtest=GroupingEvalTest -Deval.vectors=$HOME/klei-eval/gowns.vectors.json`. The table shows pair precision, recall and F1 for sensitivity 1 to 5, and per confidence band how many groups hold one gown only. Change `KLEI_EMBED_MODEL` to compare embedding models. Nothing is stored; `*.vectors.json` is git-ignored.

## Performance

`infra/ci/perf.sh` seeds 5,000 Gowns and checks the NFR-2 p95 targets on every pull request to main. `infra/ci/perf.sh --scale full` (10,000 Gowns, 100,000 Photos, 50,000 Inquiries) is run by hand before a release that touches queries. Desktop idle memory (300 MB) and cold start are measured by hand per operating system (release checklist).
