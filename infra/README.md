# infra

- `docker-compose.yml`: production-shaped services (`postgres`, `objectstore`, `mailpit` in profile `dev`). The `backend` service builds from `infra/Dockerfile`; operations are in `docs/ops.md`.
- `docker-compose.dev.yml`: loopback ports for local work. Never deploy it.
- `.env.example`: variable names and non-secret defaults. Copy to `.env` (git-ignored). Secrets have no defaults.
- `ci/gen-keys.sh`: prints a full set of secrets to stdout. `ci/smoke.sh`: stack check.

## Release checklist: pin images by digest (before the first production deploy)

Development uses tags. Production pins each image to its digest. Not done yet; do this when the Dokploy deploy is set up (release checklist, `docs/ops.md`):

1. `docker buildx imagetools inspect postgres:18.6` (same for `chrislusf/seaweedfs:4.52`), copy the `sha256:` digest.
2. Replace `image: name:tag` with `image: name:tag@sha256:<digest>` in the production compose file.
3. Re-check on every image bump; the SeaweedFS digest in architecture §9.1 was recorded on 2026-11-08.
