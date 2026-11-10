#!/bin/sh
# Story 9.4 backup: pg_dump first, then a copy of the bucket, into a new folder under $KLEI_BACKUP_TARGET.
# Everything written is ciphertext: the dump holds encrypted columns, the bucket holds sealed objects.
# Keys are NOT backed up here (docs/ops.md, infra/ops/key-custody.md): a backup without the offline keys cannot be read.
# Exit 0 = backup complete and no object missing; 1 = a step failed; 3 = backup written but a stored object is missing from the bucket.
# Run from the Dokploy scheduler if it supports compose apps, else from host cron: 17 2 * * * /path/infra/ops/backup.sh
# shortcut: no retention and no off-host push here, the destination folder is expected to be a mount that does both; add rclone/restic when the operator picks a destination (OPEN QUESTION).
set -eu

cd "$(dirname "$0")/../.."
fail() { echo "BACKUP FAIL: $*" >&2; exit 1; }

: "${KLEI_BACKUP_TARGET:?set KLEI_BACKUP_TARGET to the folder that receives backups (no default, it must live outside the Dokploy host)}"
[ -d "$KLEI_BACKUP_TARGET" ] || fail "KLEI_BACKUP_TARGET is not an existing folder"
[ -f infra/.env ] && { set -a; . infra/.env; set +a; }
: "${KLEI_S3_ACCESS_KEY:?}" "${KLEI_S3_SECRET_KEY:?}" "${KLEI_S3_BUCKET:?}"

COMPOSE="docker compose -f infra/docker-compose.yml"
NET="${COMPOSE_PROJECT_NAME:-klei}_internal"
AWS_IMAGE="${KLEI_BACKUP_AWS_IMAGE:-amazon/aws-cli:2.39.2}"
NAME="klei-$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$KLEI_BACKUP_TARGET/$NAME.partial"
FINAL="$KLEI_BACKUP_TARGET/$NAME"
[ -e "$FINAL" ] && fail "$FINAL exists"
mkdir "$WORK" "$WORK/bucket" || fail "cannot create $WORK"
trap 'echo "BACKUP FAIL: left $WORK incomplete" >&2' EXIT

echo "1/3 database"
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$WORK/db.dump" || fail "pg_dump"
$COMPOSE exec -T postgres pg_restore --list < "$WORK/db.dump" > /dev/null || fail "dump is not a readable archive"

echo "2/3 bucket"
AWS_ACCESS_KEY_ID="$KLEI_S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$KLEI_S3_SECRET_KEY" AWS_DEFAULT_REGION=us-east-1 \
  docker run --rm --network "$NET" --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
  -v "$WORK/bucket:/out" "$AWS_IMAGE" \
  s3 sync --only-show-errors --endpoint-url http://objectstore:8333 "s3://$KLEI_S3_BUCKET" /out || fail "bucket copy"

echo "3/3 integrity"
# Ids come from the dump itself, so an object deleted after the dump but before the copy is the only way to see a false alarm (run again).
$COMPOSE exec -T postgres pg_restore --data-only --table=stored_object -f - < "$WORK/db.dump" \
  | awk '/^COPY public.stored_object /{f=1;next} /^\\\.$/{f=0} f{print $1}' | sort > "$WORK/.rows"
( cd "$WORK/bucket" && ls -1 ) | sort > "$WORK/.objects"
ROWS=$(wc -l < "$WORK/.rows" | tr -d ' ')
OBJECTS=$(wc -l < "$WORK/.objects" | tr -d ' ')
comm -23 "$WORK/.rows" "$WORK/.objects" > "$WORK/missing.txt"
MISSING=$(wc -l < "$WORK/missing.txt" | tr -d ' ')
EXTRA=$(comm -13 "$WORK/.rows" "$WORK/.objects" | wc -l | tr -d ' ')
rm -f "$WORK/.rows" "$WORK/.objects"
[ "$MISSING" -gt 0 ] || rm -f "$WORK/missing.txt"

mv "$WORK" "$FINAL"
trap - EXIT
echo "integrity: stored_object rows=$ROWS bucket objects=$OBJECTS missing=$MISSING not-in-dump=$EXTRA"
echo "backup written: $FINAL"
if [ "$MISSING" -gt 0 ]; then
  echo "BACKUP INCOMPLETE: $MISSING stored object(s) are in the database but not in the bucket, ids in $FINAL/missing.txt" >&2
  exit 3
fi
