#!/bin/sh
# Prints a full set of secrets as KEY=value lines on stdout. Writes nothing to disk.
#   infra/ci/gen-keys.sh > infra/.env     (then append the non-secret keys from infra/.env.example)
set -eu

b64() { openssl rand -base64 32 | tr -d '\n'; }
hex() { openssl rand -hex "$1" | tr -d '\n'; }

kek1=$(b64)
bidx=$(b64)
jwt=$(openssl genpkey -algorithm ED25519 -outform DER | openssl base64 -A)
dbpw=$(hex 24)
s3ak=$(hex 10)
s3sk=$(hex 24)

# Keys must be pairwise distinct (the backend refuses to start otherwise).
for a in "$kek1" "$bidx" "$jwt" "$dbpw" "$s3ak" "$s3sk"; do
  n=0
  for b in "$kek1" "$bidx" "$jwt" "$dbpw" "$s3ak" "$s3sk"; do [ "$a" = "$b" ] && n=$((n + 1)); done
  [ "$n" -eq 1 ] || { echo "gen-keys: duplicate value generated, run again" >&2; exit 1; }
done

cat <<EOF
KLEI_DB_USER=klei
KLEI_DB_PASSWORD=$dbpw
KLEI_S3_ACCESS_KEY=$s3ak
KLEI_S3_SECRET_KEY=$s3sk
KLEI_KEK_1=$kek1
KLEI_KEK_ACTIVE=1
KLEI_BIDX_KEY=$bidx
KLEI_JWT_KEY=$jwt
KLEI_BOOTSTRAP_ADMIN_EMAIL=admin@example.test
KLEI_BOOTSTRAP_ADMIN_PASSWORD=Aa1-$(hex 12)
EOF
