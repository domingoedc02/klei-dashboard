# Klei Bridal Dashboard

Desktop app (Tauri) for a bridal studio, with a Kotlin/Spring Boot backend. Planning documents are in `docs/`; build order is in `docs/epics/epics.md`.

## Run the infrastructure stack

```sh
infra/ci/gen-keys.sh > infra/.env
printf 'KLEI_DB_NAME=klei\nKLEI_S3_BUCKET=klei-objects\nKLEI_S3_MIN_FREE_SPACE=5\n' >> infra/.env
docker compose -f infra/docker-compose.yml --profile dev up -d --wait
infra/ci/smoke.sh
```

Developer ports on loopback (PostgreSQL 5432, S3 8333, Mailpit 1025 and 8025):

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml --profile dev up -d --wait
```

`infra/.env` is git-ignored. Keep an offline copy of the keys apart from any backup: losing every `KLEI_KEK_*` loses all data.

## Backend

Needs JDK 25 (`export JAVA_HOME=$(/usr/libexec/java_home -v 25)` on macOS) and Docker for Testcontainers.

```sh
cd backend && ./mvnw verify
```

The compose `backend` service builds from `infra/Dockerfile`; API on 8080, Auth Web on 8081 (internal network only, no published port). `infra/ci/smoke.sh` covers health, port guard and container hardening.
