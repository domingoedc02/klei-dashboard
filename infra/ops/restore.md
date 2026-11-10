# Restore

Losing every KEK copy loses all data: a backup is ciphertext and needs the offline keys. Run this drill once before go-live (release checklist) and after any change of backup destination or key custody.

Assumptions: a backup folder written by `infra/ops/backup.sh` (`db.dump`, `bucket/`); Docker with Compose on the restore machine; the stack is the one in `infra/docker-compose.yml`. RTO 4 h, RPO 24 h. Passwords for the database and the object store are not tied to the data: a restore may use new ones.

## What you need

| Item | Where it comes from |
|---|---|
| A backup folder `klei-<UTC time>/` | `$KLEI_BACKUP_TARGET` |
| Every `KLEI_KEK_<n>` a row still needs, and `KLEI_KEK_ACTIVE` | Offline copy (`infra/ops/key-custody.md`) |
| `KLEI_BIDX_KEY` and `KLEI_JWT_KEY` | Offline copy |
| The repository at the release you restore to | Git |

`KLEI_BIDX_KEY` must be the original: every search, filter and sign-in lookup is an HMAC of it, and a new key would find nothing. `KLEI_JWT_KEY` must be the original or every User signs in again.

## Steps

All commands run in the repository root. For a drill, set `export COMPOSE_PROJECT_NAME=kleirestore` first so nothing touches a live stack, and remove it with `docker compose -f infra/docker-compose.yml down -v` afterwards.

1. Copy `infra/.env.example` to `infra/.env`. Fill the keys from the offline copy. Give the database and object store new secrets (`infra/ci/gen-keys.sh` prints some). Do not set `KLEI_BOOTSTRAP_ADMIN_*`: the restored data already has its Admin.
2. Start the stores only:
   `docker compose -f infra/docker-compose.yml up -d --wait postgres objectstore`
3. Load the database:
   `B=/path/to/klei-<UTC time>`
   `docker compose -f infra/docker-compose.yml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < $B/db.dump`
4. Load the bucket (the name is `KLEI_S3_BUCKET`):
   `set -a; . infra/.env; set +a`
   `docker run --rm --network ${COMPOSE_PROJECT_NAME:-klei}_internal --user "$(id -u):$(id -g)" -e HOME=/tmp -e AWS_DEFAULT_REGION=us-east-1 -e AWS_ACCESS_KEY_ID="$KLEI_S3_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$KLEI_S3_SECRET_KEY" -v $B/bucket:/in amazon/aws-cli:2.39.2 s3 sync --only-show-errors --endpoint-url http://objectstore:8333 /in s3://$KLEI_S3_BUCKET`
   If the bucket does not exist yet, run the same image with `s3 mb s3://$KLEI_S3_BUCKET --endpoint-url http://objectstore:8333` first.
5. Start the backend: `docker compose -f infra/docker-compose.yml up -d --wait backend`.

## If the backend does not start

The log names the variable, never a value:

- `klei startup stopped: code=wrong_kek variables=KLEI_KEK_1`: that variable holds a different key than the one that wrapped the data. Nothing was read or changed. Put the right copy back and start again.
- `code=missing_kek variables=KLEI_KEK_1`: a row still needs a key the environment lacks. Add it.
- `code=missing_variable`, `malformed_variable`, `duplicate_secret`: fix the named variable.

## Check

1. `GET /health/ready` answers up.
2. The first Admin signs in (Auth Web, then the app).
3. Gallery opens a Gown that existed at backup time, and its photo shows.
4. An Inquiry thread that had a Reply opens and the Reply reads.
5. Settings, Keys shows the rows on the expected KEK version.

Anything unreadable after a good start points at `KLEI_BIDX_KEY` (searches find nothing) or a missing object (run `backup.sh` on the live stack and read its integrity line).

## Drill results

One dated line per drill: date, who ran it, backup age, minutes from step 1 to the last check, result.

- 2026-11-10, Claude Code (Story 9.4), throwaway stack `kleirestore` from a backup of the smoke stack (8 stored objects, a few Gowns and Inquiries), minutes old, about 1 minute from step 1 to the last check, passed checks 1, 2, 3 and 5 (ready up, Admin signs in, Gown read and its full photo served, Keys status shows all rows on KEK 1) and listed Inquiries; check 4 (a thread with a Reply) was not run. Not the real stack, not the real backup destination, small data: the first drill by the operator is still due.
- (operator: add your first line here before go-live)
