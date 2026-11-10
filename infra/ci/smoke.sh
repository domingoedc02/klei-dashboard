#!/bin/sh
# Smoke test for the infrastructure stack. Run after:
#   docker compose -f infra/docker-compose.yml --profile dev up -d --wait
# Exits non-zero on the first failure. Needs a fresh database: it counts rows and the invite step adds a User.
# A throwaway stack with its own volumes: COMPOSE_PROJECT_NAME=kleismoke docker compose ... up, then the same variable here.
set -eu

cd "$(dirname "$0")/../.."
COMPOSE="docker compose -f infra/docker-compose.yml --profile dev"
NET="${COMPOSE_PROJECT_NAME:-klei}_internal"
CURL_IMAGE=curlimages/curl:8.11.1

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

[ -f infra/.env ] || fail "infra/.env missing (see infra/ci/gen-keys.sh)"
set -a; . infra/.env; set +a
: "${KLEI_S3_ACCESS_KEY:?}" "${KLEI_S3_SECRET_KEY:?}" "${KLEI_S3_BUCKET:?}"

# 1. No secret has a default: with an empty environment, compose must refuse and name the variable.
out=$(env -i PATH="$PATH" HOME="$HOME" docker compose --env-file /dev/null -f infra/docker-compose.yml config 2>&1) \
  && fail "compose config succeeded without secrets"
echo "$out" | grep -q "KLEI_DB_PASSWORD\|KLEI_DB_USER\|KLEI_S3_ACCESS_KEY" || fail "missing-variable message does not name the variable"
ok "compose refuses to start without secrets and names the variable"

# 2. The three services are healthy.
for svc in postgres objectstore mailpit backend; do
  id=$($COMPOSE ps -q "$svc")
  [ -n "$id" ] || fail "$svc not running"
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ] || fail "$svc not healthy"
  ok "$svc healthy"
done

# 3. Network isolation: postgres and objectstore only on `internal`, no published ports in this run.
for svc in postgres objectstore; do
  id=$($COMPOSE ps -q "$svc")
  nets=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$id")
  [ "$(echo $nets)" = "$NET" ] || fail "$svc networks: $nets"
  [ -z "$(docker port "$id")" ] || fail "$svc publishes a port"
done
[ "$(docker network inspect -f '{{.Internal}}' $NET)" = true ] || fail "$NET is not internal"
ok "postgres and objectstore only on the internal network, no published ports"

# 4. S3 round trip with SigV4, from a container on the internal network. Wrong credentials are denied.
s3() { # user secret method path [extra curl args]
  u=$1; k=$2; m=$3; p=$4; shift 4
  docker run --rm --network $NET $CURL_IMAGE -s -o /dev/null -w '%{http_code}' -X "$m" \
    --aws-sigv4 "aws:amz:us-east-1:s3" --user "$u:$k" "$@" "http://objectstore:8333$p"
}
B="/$KLEI_S3_BUCKET"
expect() { [ "$1" = "$2" ] || fail "$3: expected $2, got $1"; }

expect "$(s3 "$KLEI_S3_ACCESS_KEY" "wrong-$KLEI_S3_SECRET_KEY" PUT "$B")" 403 "wrong credentials create-bucket"
c=$(s3 "$KLEI_S3_ACCESS_KEY" "$KLEI_S3_SECRET_KEY" PUT "$B"); case $c in 200|409) ;; *) fail "create-bucket: $c";; esac
expect "$(s3 "$KLEI_S3_ACCESS_KEY" "$KLEI_S3_SECRET_KEY" PUT "$B/smoke.bin" --data-binary smoke)" 200 "put"
expect "$(s3 "$KLEI_S3_ACCESS_KEY" "$KLEI_S3_SECRET_KEY" HEAD "$B/smoke.bin" -I)" 200 "head"
got=$(docker run --rm --network $NET $CURL_IMAGE -s --aws-sigv4 "aws:amz:us-east-1:s3" \
  --user "$KLEI_S3_ACCESS_KEY:$KLEI_S3_SECRET_KEY" "http://objectstore:8333$B/smoke.bin")
[ "$got" = smoke ] || fail "get returned '$got'"
docker run --rm --network $NET $CURL_IMAGE -s --aws-sigv4 "aws:amz:us-east-1:s3" \
  --user "$KLEI_S3_ACCESS_KEY:$KLEI_S3_SECRET_KEY" "http://objectstore:8333$B" | grep -q "smoke.bin" || fail "list does not show smoke.bin"
expect "$(s3 "$KLEI_S3_ACCESS_KEY" "wrong-$KLEI_S3_SECRET_KEY" GET "$B/smoke.bin")" 403 "wrong credentials get"
expect "$(s3 "$KLEI_S3_ACCESS_KEY" "$KLEI_S3_SECRET_KEY" DELETE "$B/smoke.bin")" 204 "delete"
ok "S3 create-bucket, put, head, get, list, delete; wrong credentials denied"

# 5. PostgreSQL answers a query with the configured credentials.
$COMPOSE exec -T postgres psql -U "$KLEI_DB_USER" -d "${KLEI_DB_NAME:-klei}" -tAc 'select 1' | grep -qx 1 || fail "postgres query"
ok "postgres query"

# 6. Backend (Story 1.2): reached from the internal network, so no published port is needed.
bk() { # port path -> "status body"
  docker run --rm --network $NET $CURL_IMAGE -s -w ' %{http_code}' "http://backend:$1$2"
}
expect "$(bk 8080 /health)" '{"status":"up"} 200' "health on 8080"
expect "$(bk 8081 /health)" '{"status":"up"} 200' "health on 8081"
case "$(bk 8080 /health/ready)" in *" 200") ;; *) fail "readiness not 200";; esac
ok "backend health on both ports, ready"

problem404() { # port path
  out=$(bk "$1" "$2")
  case "$out" in *'"status":404'*'"code":"not_found"'*'"correlationId"'*" 404") ;; *) fail "$1$2 not a 404 problem: $out";; esac
}
problem404 8081 /api/v1/gowns
problem404 8080 /login
ok "port guard: API paths 404 on 8081, Auth Web paths 404 on 8080"

out=$(bk 8080 /api/v1/me)
case "$out" in *'"status":401'*'"code":"unauthenticated"'*'"correlationId"'*" 401") ;; *) fail "unauthenticated /api/v1/me not a 401 problem: $out";; esac
out=$(docker run --rm --network $NET $CURL_IMAGE -s -w ' %{http_code}' -H 'Authorization: Bearer not.a.token' http://backend:8080/api/v1/me)
case "$out" in *'"code":"unauthenticated"'*" 401") ;; *) fail "bad token not a 401 problem: $out";; esac
ok "GET /api/v1/me without or with a bad token is a 401 problem+json"

bid=$($COMPOSE ps -q backend)
[ "$(docker inspect -f '{{.Config.User}}' "$bid")" != "" ] || fail "backend runs as the image default user"
[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$bid")" = true ] || fail "backend root fs is writable"
[ "$(docker inspect -f '{{.HostConfig.Memory}}' "$bid")" = 1073741824 ] || fail "backend memory limit is not 1 GB"
$COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select success from flyway_schema_history where version = '"'1'"'"' | grep -qx t || fail "Flyway V1 not applied"
ok "backend non-root, read-only root fs, 1 GB limit, Flyway V1 applied"

$COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select generation::text || kek_version::text || length(wrapped_dek)::text from data_key"' | grep -qx 1160 || fail "data_key holds no wrapped DEK (Story 1.3)"
ok "one wrapped data key stored (generation 1, KEK 1, 60 bytes)"

PSQL='psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc'
q() { $COMPOSE exec -T postgres sh -c "$PSQL \"$1\""; }
[ "$(q 'select count(*) from app_user')" = 1 ] || fail "expected one bootstrap Admin"
[ "$(q 'select count(*) from audit_entry')" = 1 ] || fail "expected one bootstrap audit entry"
[ "$(q 'select count(*) from role')/$(q 'select count(*) from role_permission')" = 3/16 ] || fail "default roles not seeded (3 roles, 16 permissions)"
if [ -n "${KLEI_BOOTSTRAP_ADMIN_EMAIL:-}" ]; then
  $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -qF "$KLEI_BOOTSTRAP_ADMIN_EMAIL" && fail "Admin email found in a database dump"
fi
ok "one bootstrap Admin, one audit entry, 3 roles with 16 permissions, Admin email absent from pg_dump"

# 6b. Auth Web sign-in (Story 1.6): browser flow with PKCE from a curl container, then token exchange, API call, logout.
# The `__Host-` cookie is Secure, so the cookie is carried by hand instead of a jar. Credentials go in by variable name, never on a command line.
if [ -n "${KLEI_BOOTSTRAP_ADMIN_EMAIL:-}" ] && [ -n "${KLEI_BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
  node infra/ci/gen-tokens.mjs --check >/dev/null || fail "Auth Web token sheet is stale (node infra/ci/gen-tokens.mjs)"
  flow=$(docker run --rm --network $NET -e KLEI_BOOTSTRAP_ADMIN_EMAIL -e KLEI_BOOTSTRAP_ADMIN_PASSWORD --entrypoint sh $CURL_IMAGE -c '
    A=http://backend:8081; P=http://backend:8080
    V=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk; CH=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
    curl -s -D /tmp/h -o /tmp/p "$A/authorize?client=desktop&challenge=$CH&state=smoke-state-0123456789&redirect=klei%3A%2F%2Fauth%2Fcallback"
    C=$(grep -i "^set-cookie: __Host-klei-auth=" /tmp/h | sed "s/^[^:]*: //;s/;.*//" | tr -d "\r")
    T=$(sed -n "s/.*name=\"_csrf\" value=\"\([^\"]*\)\".*/\1/p" /tmp/p | head -1)
    echo "css:$(curl -s -o /dev/null -w "%{http_code}" "$A/static/auth.css")"
    echo "wrong:$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: $C" --data-urlencode "_csrf=$T" --data-urlencode "email=$KLEI_BOOTSTRAP_ADMIN_EMAIL" --data-urlencode "password=wrong" "$A/login")"
    curl -s -o /tmp/r -w "login:%{http_code}\n" -H "Cookie: $C" --data-urlencode "_csrf=$T" --data-urlencode "email=$KLEI_BOOTSTRAP_ADMIN_EMAIL" --data-urlencode "password=$KLEI_BOOTSTRAP_ADMIN_PASSWORD" "$A/login"
    CODE=$(grep -o "code=[A-Za-z0-9_-]*" /tmp/r | head -1 | cut -d= -f2)
    curl -s -o /tmp/t -w "token:%{http_code}\n" -H "Content-Type: application/json" -d "{\"code\":\"$CODE\",\"verifier\":\"$V\"}" "$P/api/v1/auth/token"
    AT=$(sed -n "s/.*\"accessToken\":\"\([^\"]*\)\".*/\1/p" /tmp/t); RT=$(sed -n "s/.*\"refreshToken\":\"\([^\"]*\)\".*/\1/p" /tmp/t)
    echo "me:$(curl -s -H "Authorization: Bearer $AT" "$P/api/v1/me")"
    echo "replay:$(curl -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" -d "{\"code\":\"$CODE\",\"verifier\":\"$V\"}" "$P/api/v1/auth/token")"
    echo "logout:$(curl -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" -d "{\"refreshToken\":\"$RT\"}" "$P/api/v1/auth/logout")"
    echo "after:$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $AT" "$P/api/v1/me")"
  ') || fail "sign-in container failed"
  for want in css:200 wrong:401 login:200 token:200 replay:400 logout:204 after:401; do
    echo "$flow" | grep -qx "$want" || fail "Auth Web flow: expected $want in: $(echo "$flow" | grep -v '^me:')"
  done
  echo "$flow" | grep '^me:' | grep -qF "$KLEI_BOOTSTRAP_ADMIN_EMAIL" || fail "GET /api/v1/me did not return the bootstrap Admin after sign-in"
  [ "$(q 'select count(*) from refresh_token')" = 0 ] || fail "refresh tokens remain after logout"
  [ "$(q 'select count(*) from audit_entry')" = 1 ] || fail "successful sign-in must not add an audit entry"
  ok "Auth Web sign-in, PKCE code exchange, /api/v1/me as Admin, replayed code refused, logout ends the session"
fi

# 6c. Invite and verify (Story 2.1), then forgot and reset (Story 2.2): Admin invites, Mailpit holds the mail, A2 sets a password, A3 takes the code, the new User signs in.
# Links carry the token in the fragment, so the script reads it from the mail and posts it the way fragment.js does.
if [ -n "${KLEI_BOOTSTRAP_ADMIN_EMAIL:-}" ] && [ -n "${KLEI_BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
  INVITEE="smoke-invitee-$$@example.test"
  INVITEE_PW="Sm-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')9"
  ROLE_ID=$(q 'select id from role limit 1')
  export INVITEE INVITEE_PW ROLE_ID
  SMOKE_JPEG_B64=$(base64 < infra/ci/tiny.jpg | tr -d '\n'); export SMOKE_JPEG_B64
  inv=$(docker run --rm -i --network $NET -e SMOKE_JPEG_B64 -e KLEI_BOOTSTRAP_ADMIN_EMAIL -e KLEI_BOOTSTRAP_ADMIN_PASSWORD -e INVITEE -e INVITEE_PW -e ROLE_ID -e KLEI_AI_DEV_MODE --entrypoint sh $CURL_IMAGE -s <<'EOF'
A=http://backend:8081; P=http://backend:8080; M=http://mailpit:8025
V=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk; CH=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
C=; T=
# go PATH curl-args...: sets S (status), refreshes the cookie C and the CSRF token T from the response.
go() {
  p=$1; shift
  S=$(curl -s -D /tmp/h -o /tmp/p -w "%{http_code}" -H "Cookie: $C" "$@" "$A$p")
  n=$(grep -i "^set-cookie: __Host-klei-auth=" /tmp/h | sed "s/^[^:]*: //;s/;.*//" | tr -d "\r"); [ -z "$n" ] || C=$n
  t=$(sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p' /tmp/p | head -1); [ -z "$t" ] || T=$t
}
# mail_text TO PATTERN: first match of PATTERN in the newest mail to TO, retrying while the mail is on its way.
mail_text() {
  i=0
  while [ $i -lt 20 ]; do
    for id in $(curl -s -G --data-urlencode "query=to:$1" "$M/api/v1/search" | grep -o '"ID": *"[^"]*"' | cut -d'"' -f4); do
      m=$(curl -s "$M/api/v1/message/$id" | grep -o "$2" | head -1) && [ -n "$m" ] && { echo "$m"; return; }
    done
    i=$((i+1)); sleep 1
  done
}
sign_in() { # EMAIL PASSWORD -> AT RT, prints login:/token: status
  C=; go "/authorize?client=desktop&challenge=$CH&state=smoke-state-0123456789&redirect=klei%3A%2F%2Fauth%2Fcallback"
  go /login --data-urlencode "_csrf=$T" --data-urlencode "email=$1" --data-urlencode "password=$2"
  echo "login-$3:$S"
  CODE=$(grep -o "code=[A-Za-z0-9_-]*" /tmp/p | head -1 | cut -d= -f2)
  curl -s -o /tmp/t -w "token-$3:%{http_code}\n" -H "Content-Type: application/json" -d "{\"code\":\"$CODE\",\"verifier\":\"$V\"}" "$P/api/v1/auth/token"
  AT=$(sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p' /tmp/t); RT=$(sed -n 's/.*"refreshToken":"\([^"]*\)".*/\1/p' /tmp/t)
}
out() { curl -s -o /dev/null -w "$1:%{http_code}\n" -H "Content-Type: application/json" -d "{\"refreshToken\":\"$RT\"}" "$P/api/v1/auth/logout"; }

sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" admin
body="{\"name\":\"Smoke Invitee\",\"email\":\"$INVITEE\",\"roleId\":\"$ROLE_ID\"}"
for want in invite dupe; do
  echo "$want:$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" -d "$body" "$P/api/v1/admin/users")"
done
out logout-admin

TOKEN=$(mail_text "$INVITEE" 'invite#[A-Za-z0-9_-]*' | cut -d'#' -f2)
echo "invite-mail:$([ ${#TOKEN} -eq 43 ] && echo ok || echo missing)"
C=; go /invite
go /invite/open --data-urlencode "_csrf=$T" --data-urlencode "token=$TOKEN"
echo "open:$S"
go /invite --data-urlencode "_csrf=$T" --data-urlencode "token=$TOKEN" --data-urlencode "name=Smoke Invitee" --data-urlencode "password=$INVITEE_PW" --data-urlencode "confirm=$INVITEE_PW"
echo "accept:$S"

CODE6=$(mail_text "$INVITEE" 'verification code is [0-9]\{6\}' | grep -o '[0-9]\{6\}')
echo "code-mail:$([ ${#CODE6} -eq 6 ] && echo ok || echo missing)"
go /verify --data-urlencode "_csrf=$T" --data-urlencode "code=000000x"
echo "bad-code:$S"
go /verify --data-urlencode "_csrf=$T" --data-urlencode "code=$CODE6"
echo "verify:$S"

sign_in "$INVITEE" "$INVITEE_PW" user
echo "me:$(curl -s -H "Authorization: Bearer $AT" "$P/api/v1/me")"
out logout-user

# 6d. Forgot and reset (Story 2.2): the invited User signs in, forgets the password, resets it from the mailed link.
sign_in "$INVITEE" "$INVITEE_PW" before
OLD_AT=$AT; OLD_RT=$RT
C=; go /forgot
go /forgot --data-urlencode "_csrf=$T" --data-urlencode "email=$INVITEE"
echo "forgot:$S"
go /forgot --data-urlencode "_csrf=$T" --data-urlencode "email=nobody-$INVITEE"
echo "forgot-unknown:$S"
RTOKEN=$(mail_text "$INVITEE" 'reset#[A-Za-z0-9_-]*' | cut -d'#' -f2)
echo "reset-mail:$([ ${#RTOKEN} -eq 43 ] && echo ok || echo missing)"
C=; go /reset
go /reset/open --data-urlencode "_csrf=$T" --data-urlencode "token=$RTOKEN"
echo "reset-open:$S"
NEW_PW="${INVITEE_PW}-new1"
go /reset --data-urlencode "_csrf=$T" --data-urlencode "token=$RTOKEN" --data-urlencode "password=$NEW_PW" --data-urlencode "confirm=$NEW_PW"
echo "reset:$S"
C=; go /reset
go /reset/open --data-urlencode "_csrf=$T" --data-urlencode "token=$RTOKEN"
echo "reset-replay:$S"
echo "old-access:$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $OLD_AT" "$P/api/v1/me")"
echo "old-refresh:$(curl -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" -d "{\"refreshToken\":\"$OLD_RT\"}" "$P/api/v1/auth/refresh")"
sign_in "$INVITEE" "$INVITEE_PW" oldpw
sign_in "$INVITEE" "$NEW_PW" new
out logout-new
# 6d2. Profile and password (Story 6.1): rename with If-Match, change the password from one of two sessions; the other one ends, the old password stops working.
sign_in "$INVITEE" "$NEW_PW" prof
HERE_AT=$AT; HERE_RT=$RT
sign_in "$INVITEE" "$NEW_PW" prof2
THERE_RT=$RT; AT=$HERE_AT; RT=$HERE_RT
api() { curl -s -o /tmp/o -w "%{http_code}" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" "$@"; }
echo "prof-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/me/profile")"
echo "prof-get:$(api "$P/api/v1/me/profile")"
PV=$(grep -o '"version":[0-9]*' /tmp/o | grep -o '[0-9]*$')
echo "prof-no-if-match:$(api -X PATCH -d '{"name":"SmokeRenamedZq"}' "$P/api/v1/me/profile")"
echo "prof-blank:$(api -X PATCH -H "If-Match: $PV" -d '{"name":"  "}' "$P/api/v1/me/profile")"
echo "prof-rename:$(api -X PATCH -H "If-Match: $PV" -d '{"name":"SmokeRenamedZq"}' "$P/api/v1/me/profile")"
echo "prof-renamed:$(grep -c '"name":"SmokeRenamedZq"' /tmp/o)"
echo "prof-stale:$(api -X PATCH -H "If-Match: $PV" -d '{"name":"SmokeStaleZq"}' "$P/api/v1/me/profile")"
echo "prof-me-name:$(api "$P/api/v1/me" >/dev/null; grep -c '"name":"SmokeRenamedZq"' /tmp/o)"
echo "avatar-none:$(api "$P/api/v1/me/avatar")"
echo "pw-wrong:$(api -d "{\"current\":\"wrong-Pass-1\",\"new\":\"${NEW_PW}-2\"}" "$P/api/v1/me/password")"
echo "pw-weak:$(api -d "{\"current\":\"$NEW_PW\",\"new\":\"short\"}" "$P/api/v1/me/password")"
echo "pw-change:$(api -d "{\"current\":\"$NEW_PW\",\"new\":\"${NEW_PW}-2\"}" "$P/api/v1/me/password")"
echo "pw-this-access:$(api "$P/api/v1/me")"
echo "pw-this-refresh:$(curl -s -o /tmp/t -w "%{http_code}" -H "Content-Type: application/json" -d "{\"refreshToken\":\"$HERE_RT\"}" "$P/api/v1/auth/refresh")"
RT=$(sed -n 's/.*"refreshToken":"\([^"]*\)".*/\1/p' /tmp/t)
out logout-prof
echo "pw-other-refresh:$(curl -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" -d "{\"refreshToken\":\"$THERE_RT\"}" "$P/api/v1/auth/refresh")"
sign_in "$INVITEE" "$NEW_PW" pwold
sign_in "$INVITEE" "${NEW_PW}-2" pwnew
out logout-pwnew
# 6d3. Signature and Studio (Story 6.2): the Admin sets the Studio, the invitee saves a signature that ends with it.
sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" studio
echo "studio-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/admin/workspace")"
echo "studio-get:$(api "$P/api/v1/admin/workspace")"
WV=$(grep -o '"version":[0-9]*' /tmp/o | grep -o '[0-9]*$')
echo "studio-no-if-match:$(api -X PUT -d '{"studioName":"SmokeStudioZq","studioAddress":"1 Smoke Lane"}' "$P/api/v1/admin/workspace")"
echo "studio-too-many-lines:$(api -X PUT -H "If-Match: $WV" -d '{"studioName":"SmokeStudioZq","studioAddress":"1\n2\n3\n4\n5"}' "$P/api/v1/admin/workspace")"
echo "studio-put:$(api -X PUT -H "If-Match: $WV" -d '{"studioName":"SmokeStudioZq","studioAddress":"1 Smoke Lane\nSuite 2"}' "$P/api/v1/admin/workspace")"
echo "studio-saved:$(grep -c '"studioName":"SmokeStudioZq"' /tmp/o)"
echo "studio-stale:$(api -X PUT -H "If-Match: $WV" -d '{"studioName":"SmokeStaleStudioZq","studioAddress":""}' "$P/api/v1/admin/workspace")"
out logout-studio
sign_in "$INVITEE" "${NEW_PW}-2" sig
echo "sig-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/me/signature")"
echo "sig-get:$(api "$P/api/v1/me/signature")"
echo "sig-blank:$(grep -c '"version":0' /tmp/o)"
echo "sig-no-if-match:$(api -X PUT -d '{"enabled":true,"signoff":"Warm regards,","name":"SmokeSigNameZq","title":"","phone":""}' "$P/api/v1/me/signature")"
echo "sig-too-long:$(api -X PUT -H "If-Match: 0" -d "{\"enabled\":true,\"signoff\":\"$(head -c 90 /dev/zero | tr '\0' 'x')\",\"name\":\"n\",\"title\":\"\",\"phone\":\"\"}" "$P/api/v1/me/signature")"
echo "sig-put:$(api -X PUT -H "If-Match: 0" -d '{"enabled":true,"signoff":"Warm regards,","name":"SmokeSigNameZq","title":"Consultant","phone":"+1 555 0100"}' "$P/api/v1/me/signature")"
echo "sig-preview:$(grep -c 'SmokeSigNameZq\\nConsultant\\nSmokeStudioZq .* +1 555 0100\\n1 Smoke Lane\\nSuite 2' /tmp/o)"
echo "sig-stale:$(api -X PUT -H "If-Match: 0" -d '{"enabled":false,"signoff":"","name":"","title":"","phone":""}' "$P/api/v1/me/signature")"
echo "sig-read-back:$(api "$P/api/v1/me/signature" >/dev/null; grep -c '"name":"SmokeSigNameZq"' /tmp/o)"
# 6d4. Preferences (Story 6.3): same session; defaults at version 0, a bad zone is 422, a save moves the version, /me carries them.
echo "pref-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/me/preferences")"
echo "pref-get:$(api "$P/api/v1/me/preferences")"
echo "pref-default:$(grep -c '"version":0' /tmp/o)"
PB='"dateFormat":"YYYY-MM-DD","startPage":"gallery","enterToSend":true,"newInquiry":false,"aiFinished":true,"teamActivity":false'
echo "pref-no-if-match:$(api -X PUT -d "{\"timezone\":null,$PB}" "$P/api/v1/me/preferences")"
echo "pref-bad-zone:$(api -X PUT -H "If-Match: 0" -d "{\"timezone\":\"Not/AZone\",$PB}" "$P/api/v1/me/preferences")"
echo "pref-put:$(api -X PUT -H "If-Match: 0" -d "{\"timezone\":\"Asia/Tokyo\",$PB}" "$P/api/v1/me/preferences")"
echo "pref-saved:$(grep -c '"version":1' /tmp/o)"
echo "pref-stale:$(api -X PUT -H "If-Match: 0" -d "{\"timezone\":null,$PB}" "$P/api/v1/me/preferences")"
echo "pref-me:$(api "$P/api/v1/me" >/dev/null; grep -c '"timezone":"Asia/Tokyo"' /tmp/o)"
out logout-sig

# 6d5. Inquiries (Story 7.1): two inquiries from one address make one Client; a replayed key answers 200 with the same Inquiry; the list is newest first; the badge counts both.
sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" inq
IQE="smoke-client-$$@example.test"
IQB='"clientName":"SmokeInqZq Client","clientEmail":"'"$IQE"'"'
echo "inq-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/inquiries/count")"
echo "inq-count-0:$(api "$P/api/v1/inquiries/count" >/dev/null; grep -c '"count":0' /tmp/o)"
echo "inq-bad:$(api -d '{"clientName":"x","clientEmail":"nope","subject":"s","body":"b"}' "$P/api/v1/inquiries")"
echo "inq-create-1:$(api -H "Idempotency-Key: smoke-inq-$$" -d "{$IQB,\"subject\":\"SmokeInqZq First\",\"body\":\"SmokeInqZq body one\"}" "$P/api/v1/inquiries")"
IQ1=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/o)
echo "inq-replay:$(api -H "Idempotency-Key: smoke-inq-$$" -d "{$IQB,\"subject\":\"SmokeInqZq First\",\"body\":\"SmokeInqZq body one\"}" "$P/api/v1/inquiries")"
echo "inq-replay-same:$(grep -c "\"id\":\"$IQ1\"" /tmp/o)"
echo "inq-create-2:$(api -d "{$IQB,\"subject\":\"SmokeInqZq Second\",\"body\":\"SmokeInqZq body two\"}" "$P/api/v1/inquiries")"
IQ2=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/o)
echo "inq-list:$(api -d '{"status":"new"}' "$P/api/v1/inquiries/query")"
echo "inq-listed:$(grep -o '"subject":"SmokeInqZq [A-Za-z]*"' /tmp/o | wc -l | tr -d ' ')"
echo "inq-newest-first:$(grep -o '"subject":"SmokeInqZq [A-Za-z]*"' /tmp/o | head -1 | grep -c Second)"
echo "inq-closed-none:$(api -d '{"status":"closed"}' "$P/api/v1/inquiries/query" >/dev/null; grep -c '"items":\[\]' /tmp/o)"
echo "inq-count-2:$(api "$P/api/v1/inquiries/count" >/dev/null; grep -c '"count":2' /tmp/o)"
# 6d6. Read an Inquiry (Story 7.2): GET never marks it read; POST read does, once, for everyone; the badge drops; the Client profile lists the Inquiries.
echo "inq-get:$(api "$P/api/v1/inquiries/$IQ2")"
echo "inq-get-body:$(grep -c '"body":"SmokeInqZq body two"' /tmp/o)"
echo "inq-get-unread:$(grep -c '"unread":true' /tmp/o)"
IQC=$(sed -n 's/.*"client":{"id":"\([^"]*\)".*/\1/p' /tmp/o)
echo "inq-get-unknown:$(api "$P/api/v1/inquiries/00000000-0000-4000-8000-000000000000")"
echo "inq-get-kept-count:$(api "$P/api/v1/inquiries/count" >/dev/null; grep -c '"count":2' /tmp/o)"
echo "inq-read-anon:$(curl -s -o /dev/null -w "%{http_code}" -X POST "$P/api/v1/inquiries/$IQ2/read")"
echo "inq-read:$(api -X POST "$P/api/v1/inquiries/$IQ2/read")"
echo "inq-read-again:$(api -X POST "$P/api/v1/inquiries/$IQ2/read")"
echo "inq-read-count:$(api "$P/api/v1/inquiries/count" >/dev/null; grep -c '"count":1' /tmp/o)"
echo "inq-get-read:$(api "$P/api/v1/inquiries/$IQ2" >/dev/null; grep -c '"unread":false' /tmp/o)"
echo "inq-client:$(api "$P/api/v1/clients/$IQC")"
echo "inq-client-rows:$(grep -o '"subject":"SmokeInqZq [A-Za-z]*"' /tmp/o | wc -l | tr -d ' ')"
echo "inq-client-unknown:$(api "$P/api/v1/clients/00000000-0000-4000-8000-000000000000")"
# 6d7. Reply (Story 7.3): draft round trip, a key is required, one mail reaches the Client, a replayed key sends nothing more, status becomes Replied, the draft is gone.
RPB='{"body":"<div>SmokeRpZq <b>hello</b></div>"}'
echo "inq-draft-empty:$(api "$P/api/v1/inquiries/$IQ1/draft" >/dev/null; grep -c '"body":""' /tmp/o)"
echo "inq-draft-put:$(api -X PUT -d '{"body":"<div>SmokeRpZq draft</div>"}' "$P/api/v1/inquiries/$IQ1/draft")"
echo "inq-draft-get:$(api "$P/api/v1/inquiries/$IQ1/draft" >/dev/null; grep -c 'SmokeRpZq draft' /tmp/o)"
echo "inq-reply-anon:$(curl -s -o /dev/null -w "%{http_code}" -X POST "$P/api/v1/inquiries/$IQ1/reply")"
echo "inq-reply-nokey:$(api -d "$RPB" "$P/api/v1/inquiries/$IQ1/reply")"
echo "inq-reply-blank:$(api -H "Idempotency-Key: smoke-rp-blank-$$" -d '{"body":"<div> </div>"}' "$P/api/v1/inquiries/$IQ1/reply")"
echo "inq-reply:$(api -H "Idempotency-Key: smoke-rp-$$" -d "$RPB" "$P/api/v1/inquiries/$IQ1/reply")"
RPM=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/o | head -1)
echo "inq-reply-sent:$(grep -c '"mailState":"sent"' /tmp/o)"
echo "inq-reply-replay:$(api -H "Idempotency-Key: smoke-rp-$$" -d "$RPB" "$P/api/v1/inquiries/$IQ1/reply")"
echo "inq-reply-replay-same:$(grep -c "\"id\":\"$RPM\"" /tmp/o)"
echo "inq-reply-mail:$([ -n "$(mail_text "$IQE" 'SmokeRpZq')" ] && echo ok || echo missing)"
echo "inq-reply-one-mail:$(curl -s -G --data-urlencode "query=to:$IQE" "$M/api/v1/search" | grep -o '"ID": *"[^"]*"' | wc -l | tr -d ' ')"
echo "inq-reply-status:$(api "$P/api/v1/inquiries/$IQ1" >/dev/null; grep -c '"status":"replied"' /tmp/o)"
echo "inq-reply-unread:$(grep -c '"unread":false' /tmp/o)"
echo "inq-draft-gone:$(api "$P/api/v1/inquiries/$IQ1/draft" >/dev/null; grep -c '"body":""' /tmp/o)"
echo "inq-reply-count:$(api "$P/api/v1/inquiries/count" >/dev/null; grep -c '"count":0' /tmp/o)"
echo "inq-retry-sent:$(api -X POST "$P/api/v1/messages/$RPM/retry")"
echo "inq-reply-listed:$(api -d '{"status":"replied"}' "$P/api/v1/inquiries/query" >/dev/null; grep -c 'SmokeInqZq First' /tmp/o)"
# 6d8. Status and Client edits (Story 7.4): a stale version and a missing header are refused, Close lists under Closed and blocks Reply, Reopen returns it to New, a Client edit saves all five fields with the version.
api "$P/api/v1/inquiries/$IQ2" >/dev/null; IV=$(grep -o '"version":[0-9]*' /tmp/o | tail -1 | grep -o '[0-9]*$')
echo "inq-status-nokey:$(api -X PATCH -d '{"status":"closed"}' "$P/api/v1/inquiries/$IQ2")"
echo "inq-status-stale:$(api -X PATCH -H 'If-Match: 999' -d '{"status":"closed"}' "$P/api/v1/inquiries/$IQ2")"
echo "inq-status-bad:$(api -X PATCH -H "If-Match: $IV" -d '{"status":"archived"}' "$P/api/v1/inquiries/$IQ2")"
echo "inq-close:$(api -X PATCH -H "If-Match: $IV" -d '{"status":"closed"}' "$P/api/v1/inquiries/$IQ2")"
IV=$(grep -o '"version":[0-9]*' /tmp/o | grep -o '[0-9]*$')
echo "inq-closed-listed:$(api -d '{"status":"closed"}' "$P/api/v1/inquiries/query" >/dev/null; grep -c 'SmokeInqZq Second' /tmp/o)"
echo "inq-reply-closed:$(api -H "Idempotency-Key: smoke-rp-closed-$$" -d "$RPB" "$P/api/v1/inquiries/$IQ2/reply")"
echo "inq-reopen:$(api -X PATCH -H "If-Match: $IV" -d '{"status":"new"}' "$P/api/v1/inquiries/$IQ2")"
echo "inq-reopened:$(api "$P/api/v1/inquiries/$IQ2" >/dev/null; grep -c '"status":"new"' /tmp/o)"
api "$P/api/v1/clients/$IQC" >/dev/null; CV=$(grep -o '"version":[0-9]*' /tmp/o | tail -1 | grep -o '[0-9]*$')
CEB='{"phone":"+1 555 0100","city":"SmokeCeZq City","weddingDate":"2027-06-12","source":"Referral","note":"SmokeCeZq note"}'
echo "inq-client-nokey:$(api -X PATCH -d "$CEB" "$P/api/v1/clients/$IQC")"
echo "inq-client-stale:$(api -X PATCH -H 'If-Match: 999' -d "$CEB" "$P/api/v1/clients/$IQC")"
echo "inq-client-bad:$(api -X PATCH -H "If-Match: $CV" -d '{"phone":"","city":"","weddingDate":"2027-13-40","source":"","note":""}' "$P/api/v1/clients/$IQC")"
echo "inq-client-edit:$(api -X PATCH -H "If-Match: $CV" -d "$CEB" "$P/api/v1/clients/$IQC")"
echo "inq-client-saved:$(api "$P/api/v1/clients/$IQC" >/dev/null; grep -c 'SmokeCeZq note' /tmp/o)"
# 6d9. Notifications (Story 8.1): the invite the invitee accepted told this Admin; list, read, a bad read, clear.
echo "notif-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/notifications")"
echo "notif-list:$(api "$P/api/v1/notifications")"
echo "notif-invite:$(grep -c 'Smoke Invitee accepted the invite' /tmp/o)"
echo "notif-unread:$(grep -c '"unread":[1-9]' /tmp/o)"
NID=$(sed -n 's/.*"items":\[{"id":"\([^"]*\)".*/\1/p' /tmp/o)
echo "notif-read-empty:$(api -d '{"ids":[]}' "$P/api/v1/notifications/read")"
echo "notif-read:$(api -d "{\"ids\":[\"$NID\"]}" "$P/api/v1/notifications/read")"
echo "notif-read-back:$(api "$P/api/v1/notifications" >/dev/null; grep -c '"read":true' /tmp/o)"
echo "notif-clear:$(api -X DELETE "$P/api/v1/notifications")"
echo "notif-cleared:$(api "$P/api/v1/notifications" >/dev/null; grep -c '"items":\[\]' /tmp/o)"
# 6d10. Global search (Story 8.2): a word from an Inquiry subject (the Gown search is in 6m), a missing q, punctuation only, no token.
echo "search-anon:$(curl -s -o /dev/null -w "%{http_code}" -X POST "$P/api/v1/search")"
echo "search-missing:$(api -d '{}' "$P/api/v1/search")"
echo "search-punct:$(api -d '{"q":"!?-"}' "$P/api/v1/search" >/dev/null; grep -c '"items":\[\]' /tmp/o)"
echo "search-inquiry:$(api -d '{"q":"SmokeInqZq"}' "$P/api/v1/search" >/dev/null; grep -c '"kind":"inquiry"' /tmp/o)"
out logout-inq

# 6e. Staff screen (Story 2.3): list, edit with If-Match, resend, delete. Needs no extra user at the end: the new one is deleted again.
sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" staff
api() { curl -s -o /tmp/o -w "%{http_code}" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" "$@"; }
S2="smoke-staff2-$$@example.test"; S3="smoke-staff3-$$@example.test"
echo "s-list:$(api "$P/api/v1/admin/users")"
echo "s-listed:$(grep -c "\"email\":\"$INVITEE\"" /tmp/o)"
echo "s-invite:$(api -d "{\"name\":\"Smoke Two\",\"email\":\"$S2\",\"roleId\":\"$ROLE_ID\"}" "$P/api/v1/admin/users")"
SID=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/o)
api "$P/api/v1/admin/users" >/dev/null
VER=$(grep -o "\"id\":\"$SID\"[^}]*\"version\":[0-9]*" /tmp/o | grep -o '[0-9]*$')
echo "s-no-if-match:$(api -X PATCH -d '{"name":"X"}' "$P/api/v1/admin/users/$SID")"
echo "s-stale:$(api -X PATCH -H 'If-Match: 999' -d '{"name":"X"}' "$P/api/v1/admin/users/$SID")"
echo "s-edit:$(api -X PATCH -H "If-Match: $VER" -d "{\"name\":\"Smoke Three\",\"email\":\"$S3\"}" "$P/api/v1/admin/users/$SID")"
echo "s-resend:$(api -X POST "$P/api/v1/admin/users/$SID/resend")"
T3=$(mail_text "$S3" 'invite#[A-Za-z0-9_-]*' | cut -d'#' -f2)
echo "s-mail:$([ ${#T3} -eq 43 ] && echo ok || echo missing)"
echo "s-delete:$(api -X DELETE "$P/api/v1/admin/users/$SID")"
echo "s-stale-after-delete:$(api "$P/api/v1/admin/users")"
out logout-staff
sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" staff2
echo "s-gone:$(api -X POST "$P/api/v1/admin/users/$SID/resend")"
echo "edited:$S3"
out logout-staff2

# 6f. Roles matrix (Story 2.4): read, change a Role, the old token goes stale, refresh keeps the sign-in, change back.
sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" roles
echo "r-matrix:$(api "$P/api/v1/admin/roles")"
echo "r-locked:$(grep -c '"name":"Admin","locked":true' /tmp/o)"
STAFF=$(grep -o '"id":"[^"]*","name":"Staff","locked":false,"permissions":\[[^]]*\],"version":[0-9]*' /tmp/o)
ADMIN_RID=$(grep -o '"id":"[^"]*","name":"Admin"' /tmp/o | sed 's/^"id":"\([^"]*\)".*/\1/')
RID=$(echo "$STAFF" | sed 's/^"id":"\([^"]*\)".*/\1/'); RVER=$(echo "$STAFF" | grep -o '[0-9]*$')
RPERMS=$(echo "$STAFF" | sed 's/.*"permissions":\(\[[^]]*\]\).*/\1/'); LESS=$(echo "$RPERMS" | sed 's/,"PERM_REPLY"//')
echo "r-no-if-match:$(api -X PUT -d "{\"roleId\":\"$RID\",\"permissions\":$LESS}" "$P/api/v1/admin/roles")"
echo "r-admin-locked:$(api -X PUT -H 'If-Match: 1' -d "{\"roleId\":\"$ADMIN_RID\",\"permissions\":[\"PERM_VIEW_GALLERY\"]}" "$P/api/v1/admin/roles")"
echo "r-change:$(api -X PUT -H "If-Match: $RVER" -d "{\"roleId\":\"$RID\",\"permissions\":$LESS}" "$P/api/v1/admin/roles")"
echo "r-stale-token:$(api "$P/api/v1/admin/roles")"
echo "r-refresh:$(curl -s -o /tmp/t -w "%{http_code}" -H "Content-Type: application/json" -d "{\"refreshToken\":\"$RT\"}" "$P/api/v1/auth/refresh")"
AT=$(sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p' /tmp/t); RT=$(sed -n 's/.*"refreshToken":"\([^"]*\)".*/\1/p' /tmp/t)
echo "r-after:$(api "$P/api/v1/admin/roles")"
NOW=$(grep -o '"name":"Staff","locked":false,"permissions":\[[^]]*\],"version":[0-9]*' /tmp/o)
echo "r-less:$(echo "$NOW" | grep -c PERM_REPLY)"
NEWVER=$(echo "$NOW" | grep -o '[0-9]*$')
echo "r-restore:$(api -X PUT -H "If-Match: $NEWVER" -d "{\"roleId\":\"$RID\",\"permissions\":$RPERMS}" "$P/api/v1/admin/roles")"
out logout-roles
sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" audit
echo "a-page:$(api "$P/api/v1/admin/audit")"
echo "a-roles-entry:$(grep -o '"action":"role_permissions_changed"' /tmp/o | wc -l | tr -d ' ')"
echo "a-newest-first:$([ "$(grep -o '"action":"[a-z_]*"' /tmp/o | head -1)" = '"action":"role_permissions_changed"' ] && echo ok || echo no)"
echo "a-bad-page:$(api "$P/api/v1/admin/audit?page=0")"
echo "a-write:$(api -X DELETE "$P/api/v1/admin/audit")"
out logout-audit
# 6g. Photo upload (Story 4.1): open a batch, upload a tiny JPEG with a comment segment and a recognisable file name, retry the same key, refuse a text file, read both sizes back.
sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" upl
echo "up-anon:$(curl -s -o /dev/null -w "%{http_code}" -X POST "$P/api/v1/uploads")"
echo "up-open:$(api -X POST "$P/api/v1/uploads")"
UB=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/o | head -1)
printf %s "$SMOKE_JPEG_B64" | base64 -d > /tmp/tiny.jpg
up() { curl -s -o /tmp/o -w "%{http_code}" -H "Authorization: Bearer $AT" -H "Idempotency-Key: $1" -F "file=@$2;filename=$3;type=image/jpeg" "$P/api/v1/uploads/$UB/photos"; }
echo "up-photo:$(up smoke-up-1 /tmp/tiny.jpg SmokeUploadZq.jpg)"
UP=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/o)
echo "up-name-echo:$(grep -c SmokeUploadZq /tmp/o)"
echo "up-retry:$(up smoke-up-1 /tmp/tiny.jpg SmokeUploadZq.jpg)"
echo "up-retry-same:$([ "$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/o)" = "$UP" ] && echo ok || echo no)"
printf 'plain words' > /tmp/x.txt
echo "up-text:$(up smoke-up-2 /tmp/x.txt SmokeTextZq.jpg)"
echo "up-text-echo:$(grep -c SmokeTextZq /tmp/o)"
echo "up-thumb:$(curl -s -o /tmp/th -w "%{http_code}" -H "Authorization: Bearer $AT" "$P/api/v1/uploads/$UB/photos/$UP?size=thumb")"
echo "up-full:$(curl -s -o /tmp/full -w "%{http_code}" -H "Authorization: Bearer $AT" "$P/api/v1/uploads/$UB/photos/$UP?size=full")"
echo "up-full-same:$(cmp -s /tmp/tiny.jpg /tmp/full && echo ok || echo no)"
echo "up-current:$(api "$P/api/v1/uploads/current")"
echo "up-current-rejected:$(grep -c '"rejected":1' /tmp/o)"
out logout-upl
if [ "${KLEI_AI_DEV_MODE:-false}" = true ]; then
sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" ai
echo "ai-get:$(api "$P/api/v1/admin/ai")"
AIV=$(sed -n 's/.*"version":\([0-9]*\).*/\1/p' /tmp/o)
AIBODY='{"preset":"custom","baseUrl":"http://ai-stub:8080/v1","apiKey":"smoke-stub-key","chatModel":"stub-chat","visionModel":"stub-chat","embeddingModel":"dinov2-base","temperature":0.2,"maxTokens":1024}'
echo "ai-no-if-match:$(api -X PUT -d "$AIBODY" "$P/api/v1/admin/ai")"
echo "ai-save:$(api -X PUT -H "If-Match: $AIV" -d "$AIBODY" "$P/api/v1/admin/ai")"
echo "ai-key-echo:$(grep -c 'smoke-stub-key' /tmp/o)"
echo "ai-key-set:$(grep -c '"apiKeySet":true' /tmp/o)"
echo "ai-test:$(api -X POST "$P/api/v1/admin/ai/test")"
echo "ai-test-ok:$(grep -o '"ok":true' /tmp/o | wc -l | tr -d ' ')"
echo "ai-test-status:$(grep -c '"status":"connected"' /tmp/o)"
echo "ai-reread:$(api "$P/api/v1/admin/ai")"
echo "ai-reread-key:$(grep -c 'smoke-stub-key' /tmp/o)"
echo "ai-reread-status:$(grep -c '"status":"connected"' /tmp/o)"
echo "ai-behavior:$(grep -c '"tone":"warm"' /tmp/o)"
echo "usage-get:$(api "$P/api/v1/admin/ai/usage")"
echo "usage-test-row:$(grep -c '"purpose":"test","model":"[^"]*","size":[0-9]*,"outcome":"ok"' /tmp/o)"
echo "usage-no-bodies:$(grep -c '"prompt"\|"response"' /tmp/o)"
echo "usage-bad-page:$(api "$P/api/v1/admin/ai/usage?page=0")"
echo "tx-get:$(api "$P/api/v1/taxonomy")"
echo "tx-seeds:$(grep -o '"value":' /tmp/o | wc -l | tr -d ' ')"
echo "tx-mikado:$(grep -c '"Mikado"' /tmp/o)"
TXV="SmokeTaxZq$$"
echo "tx-add:$(api -X PUT -d "{\"op\":\"add\",\"type\":\"fabric\",\"value\":\"$TXV\"}" "$P/api/v1/taxonomy")"
TXI=$(grep -o "\"id\":\"[^\"]*\",\"type\":\"fabric\",\"value\":\"$TXV\",\"version\":[0-9]*" /tmp/o)
TXID=$(echo "$TXI" | sed 's/^"id":"\([^"]*\)".*/\1/'); TXVER=$(echo "$TXI" | grep -o '[0-9]*$')
echo "tx-dupe:$(api -X PUT -d "{\"op\":\"add\",\"type\":\"fabric\",\"value\":\"$(echo "$TXV" | tr 'A-Z' 'a-z')\"}" "$P/api/v1/taxonomy")"
echo "tx-no-if-match:$(api -X PUT -d "{\"op\":\"remove\",\"id\":\"$TXID\"}" "$P/api/v1/taxonomy")"
echo "tx-stale:$(api -X PUT -H "If-Match: $((TXVER + 5))" -d "{\"op\":\"remove\",\"id\":\"$TXID\"}" "$P/api/v1/taxonomy")"
echo "tx-remove:$(api -X PUT -H "If-Match: $TXVER" -d "{\"op\":\"remove\",\"id\":\"$TXID\"}" "$P/api/v1/taxonomy")"
echo "tx-removed:$(grep -c "$TXV" /tmp/o)"
# 6j. Grouping (Story 4.3): five more photos make six; the stub answers the six embedding calls in order as gown A, A, B, B, C, C (scenario embed-seq), so three groups are expected.
for n in 2 3 4 5 6; do echo "grp-photo-$n:$(up smoke-up-g$n /tmp/tiny.jpg SmokeGroupZq$n.jpg)"; done
echo "grp-start:$(api -X POST "$P/api/v1/uploads/$UB/start")"
i=0; ph=
while [ $i -lt 60 ]; do
  api "$P/api/v1/uploads/$UB" > /dev/null
  ph=$(sed -n 's/.*"phase":"\([a-z]*\)".*/\1/p' /tmp/o | head -1)
  if [ "$ph" = review ] || [ "$ph" = error ]; then break; fi
  i=$((i+1)); sleep 1
done
echo "grp-phase:$ph"
echo "grp-groups:$(grep -o '"name":"SmokeGownZq"' /tmp/o | wc -l | tr -d ' ')"
echo "grp-name-echo:$(grep -c SmokeGroupZq /tmp/o)"
# 6k. Review edit (Story 4.5): the first group in the status answer is renamed, retagged and described.
GID=$(grep -o '"id":"[^"]*","name":"SmokeGownZq"' /tmp/o | head -1 | sed 's/^"id":"\([^"]*\)".*/\1/')
GVER=$(grep -o '"version":[0-9]*' /tmp/o | head -1 | grep -o '[0-9]*$')
echo "grp-edit-no-if-match:$(api -X PATCH -d '{"name":"x"}' "$P/api/v1/uploads/$UB/groups/$GID")"
echo "grp-edit-stale:$(api -X PATCH -H "If-Match: $((GVER + 5))" -d '{"name":"x"}' "$P/api/v1/uploads/$UB/groups/$GID")"
echo "grp-edit:$(api -X PATCH -H "If-Match: $GVER" -d '{"name":"SmokeEditZq","description":"SmokeEditDescZq","attributes":[{"type":"fabric","value":"Mikado"}]}' "$P/api/v1/uploads/$UB/groups/$GID")"
echo "grp-edit-echo:$(grep -c SmokeEditZq /tmp/o)"
echo "grp-edit-bad:$(api -X PATCH -H "If-Match: $((GVER + 1))" -d '{"attributes":[{"type":"fabric","value":"NoSuchFabricZq"}]}' "$P/api/v1/uploads/$UB/groups/$GID")"
# 6l. Rearrange (Story 4.6): move a photo into a new group, refuse a stale version, discard it (the new group goes), restore it.
api "$P/api/v1/uploads/$UB" > /dev/null
RPH=$(sed -n 's/.*"id":"'"$GID"'"[^[]*"photoIds":\["\([^"]*\)".*/\1/p' /tmp/o | head -1)
RVER=$((GVER + 1))
echo "grp-mv-no-if-match:$(api -X POST -d '{"groupId":null}' "$P/api/v1/uploads/$UB/photos/$RPH/move")"
echo "grp-mv:$(api -X POST -H "If-Match: $RVER" -d '{"groupId":null}' "$P/api/v1/uploads/$UB/photos/$RPH/move")"
echo "grp-mv-groups:$(grep -o '"band":"' /tmp/o | wc -l | tr -d ' ')"
NGVER=$(sed -n 's/.*"name":"New group"[^}]*"version":\([0-9]*\).*/\1/p' /tmp/o | head -1)
echo "grp-mv-stale:$(api -X POST -H "If-Match: $RVER" -d '{"groupId":null}' "$P/api/v1/uploads/$UB/photos/$RPH/move")"
echo "grp-discard:$(api -X POST -H "If-Match: $NGVER" "$P/api/v1/uploads/$UB/photos/$RPH/discard")"
echo "grp-discard-groups:$(grep -o '"band":"' /tmp/o | wc -l | tr -d ' ')"
echo "grp-discard-again:$(api -X POST -H "If-Match: $NGVER" "$P/api/v1/uploads/$UB/photos/$RPH/discard")"
echo "grp-restore:$(api -X POST -d "{\"groupId\":\"$GID\"}" "$P/api/v1/uploads/$UB/photos/$RPH/restore")"
echo "grp-restore-groups:$(grep -o '"band":"' /tmp/o | wc -l | tr -d ' ')"
echo "grp-start-again:$(api -X POST "$P/api/v1/uploads/$UB/start")"
echo "grp-usage:$(api "$P/api/v1/admin/ai/usage")"
echo "grp-usage-embeds:$(grep -o '"purpose":"embed"' /tmp/o | wc -l | tr -d ' ')"
echo "grp-usage-describes:$(grep -o '"purpose":"describe"' /tmp/o | wc -l | tr -d ' ')"
echo "grp-usage-desc-echo:$(grep -c 'SmokeDescZq' /tmp/o)"
echo "grp-usage-verifies:$(grep -o '"purpose":"verify"' /tmp/o | wc -l | tr -d ' ')"
# 6l. Save or discard (Story 4.7): save the three groups as Gowns, replay the save, then open a batch and discard it.
echo "save-anon:$(curl -s -o /dev/null -w "%{http_code}" -X POST "$P/api/v1/uploads/$UB/save")"
echo "save-unknown:$(api -X POST "$P/api/v1/uploads/00000000-0000-4000-8000-000000000000/save")"
echo "save:$(api -X POST "$P/api/v1/uploads/$UB/save")"
echo "save-count:$(grep -o '"saved":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
echo "save-again:$(api -X POST "$P/api/v1/uploads/$UB/save")"
echo "save-again-count:$(grep -o '"saved":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
# 6m. Gallery (Story 5.1): the three saved Gowns, a window, a tag that matches nothing, bad input, one thumbnail with its headers.
echo "gal-anon:$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{}' "$P/api/v1/gowns/query")"
echo "gal:$(api -X POST -d '{}' "$P/api/v1/gowns/query")"
echo "gal-total:$(grep -o '"total":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
echo "gal-cards:$(grep -o '"thumbs":\[' /tmp/o | wc -l | tr -d ' ')"
GWN=$(sed -n 's/^{"items":\[{"id":"\([0-9a-f-]*\)".*/\1/p' /tmp/o)
GPH=$(grep -o '"thumbs":\["[0-9a-f-]*"' /tmp/o | head -1 | grep -o '[0-9a-f]\{8\}-[0-9a-f-]*')
GWORD=$(sed -n 's/^{"items":\[{"id":"[0-9a-f-]*","name":"\([A-Za-z0-9]*\).*/\1/p' /tmp/o)
echo "search-gown:$(api -d "{\"q\":\"$GWORD\"}" "$P/api/v1/search" >/dev/null; grep -c "\"id\":\"$GWN\"" /tmp/o)"
echo "gal-week:$(api -X POST -d '{"days":7}' "$P/api/v1/gowns/query")"
echo "gal-week-matching:$(grep -o '"matching":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
echo "gal-nomatch:$(api -X POST -d '{"silhouette":["00000000-0000-4000-8000-000000000000"]}' "$P/api/v1/gowns/query")"
echo "gal-nomatch-matching:$(grep -o '"matching":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
echo "gal-bad-days:$(api -X POST -d '{"days":5}' "$P/api/v1/gowns/query")"
echo "gal-thumb:$(curl -s -D /tmp/h -o /tmp/img -w "%{http_code}" -H "Authorization: Bearer $AT" "$P/api/v1/gowns/$GWN/photos/$GPH?size=thumb")"
echo "gal-thumb-type:$(tr -d '\r' < /tmp/h | grep -ic '^content-type: image/jpeg')"
echo "gal-thumb-nostore:$(tr -d '\r' < /tmp/h | grep -ic '^cache-control: .*no-store')"
echo "gal-thumb-bytes:$([ "$(wc -c < /tmp/img)" -gt 100 ] && echo ok || echo tiny)"
# 6n. Gown viewer (Story 5.2): one Gown read, its first Photo at full size with the same headers, an unknown Gown.
echo "view-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/gowns/$GWN")"
echo "view:$(api "$P/api/v1/gowns/$GWN")"
echo "view-photos:$([ "$(grep -o '"photoCount":[0-9]*' /tmp/o | grep -o '[0-9]*$')" -ge 1 ] && echo ok || echo none)"
echo "view-band:$(grep -c '"band":"[a-z]*"' /tmp/o)"
echo "view-full:$(curl -s -D /tmp/h -o /tmp/img -w "%{http_code}" -H "Authorization: Bearer $AT" "$P/api/v1/gowns/$GWN/photos/$GPH?size=full")"
echo "view-full-type:$(tr -d '\r' < /tmp/h | grep -ic '^content-type: image/jpeg')"
echo "view-full-nostore:$(tr -d '\r' < /tmp/h | grep -ic '^cache-control: .*no-store')"
echo "view-unknown:$(api "$P/api/v1/gowns/00000000-0000-4000-8000-000000000000")"
# 6o. Edit a Gown (Story 5.3): the version from the read is the If-Match; a stale one is 409; the new words reach the Gallery and no dump.
api "$P/api/v1/gowns/$GWN" > /dev/null; GV=$(grep -o '"version":[0-9]*' /tmp/o | grep -o '[0-9]*$')
echo "gedit-anon:$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H "If-Match: $GV" -H "Content-Type: application/json" -d '{"name":"SmokeCedarZq"}' "$P/api/v1/gowns/$GWN")"
echo "gedit-no-if-match:$(api -X PATCH -d '{"name":"SmokeCedarZq"}' "$P/api/v1/gowns/$GWN")"
echo "gedit:$(api -X PATCH -H "If-Match: $GV" -d '{"name":"SmokeCedarZq","description":"SmokeCedarDescZq"}' "$P/api/v1/gowns/$GWN")"
echo "gedit-name:$(grep -c SmokeCedarZq /tmp/o)"
GV2=$(grep -o '"version":[0-9]*' /tmp/o | grep -o '[0-9]*$')
echo "gedit-version:$([ "$GV2" -gt "$GV" ] && echo ok || echo same)"
echo "gedit-stale:$(api -X PATCH -H "If-Match: $GV" -d '{"name":"SmokeStaleZq"}' "$P/api/v1/gowns/$GWN")"
echo "gedit-bad:$(api -X PATCH -H "If-Match: $GV2" -d '{"name":"   "}' "$P/api/v1/gowns/$GWN")"
echo "gedit-unknown:$(api -X PATCH -H "If-Match: 0" -d '{"name":"x"}' "$P/api/v1/gowns/00000000-0000-4000-8000-000000000000")"
echo "gedit-gallery:$(api -X POST -d '{}' "$P/api/v1/gowns/query")"
echo "gedit-gallery-name:$(grep -c SmokeCedarZq /tmp/o)"
# 6p. Download .zip (Story 5.4): the manifest is the whole server side; the archive is built on the desktop, so none may exist here.
echo "export-anon:$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{\"ids\":[\"$GWN\"]}" "$P/api/v1/gowns/export")"
echo "export-empty:$(api -X POST -d '{"ids":[]}' "$P/api/v1/gowns/export")"
echo "export:$(api -X POST -d "{\"ids\":[\"$GWN\",\"00000000-0000-4000-8000-000000000000\"]}" "$P/api/v1/gowns/export")"
echo "export-name:$(grep -c SmokeCedarZq /tmp/o)"
echo "export-details:$(grep -c 'Name: SmokeCedarZq' /tmp/o)"
echo "export-missing:$(grep -c '"missing":\["00000000-0000-4000-8000-000000000000"\]' /tmp/o)"
echo "export-too-many:$(api -X POST -d "{\"ids\":[$(for i in $(seq 1 101); do printf '"00000000-0000-4000-8000-%012d",' $i; done | sed 's/,$//')]}" "$P/api/v1/gowns/export")"
echo "save-gone:$(api "$P/api/v1/uploads/current")"
echo "save-open:$(api -X POST "$P/api/v1/uploads")"
OLDUB=$UB
UB=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/o | head -1)
echo "save-new-batch:$([ "$UB" != "$OLDUB" ] && echo ok || echo same)"
echo "save-up:$(up smoke-up-s1 /tmp/tiny.jpg SmokeSavedZq.jpg)"
echo "save-discard:$(api -X DELETE "$P/api/v1/uploads/$UB")"
echo "save-discard-again:$(api -X DELETE "$P/api/v1/uploads/$UB")"
echo "save-audit:$(api "$P/api/v1/admin/audit")"
echo "save-audit-saved:$(grep -o '"action":"upload_saved"' /tmp/o | wc -l | tr -d ' ')"
echo "save-audit-discarded:$(grep -o '"action":"upload_discarded"' /tmp/o | wc -l | tr -d ' ')"
# 6q. Delete Gowns (Story 5.5): one Gown goes with its Photos, tags, words and bucket objects; the others stay. The counts are checked after the run.
api "$P/api/v1/gowns/$GWN" > /dev/null; DELPH=$(grep -o '"photoCount":[0-9]*' /tmp/o | grep -o '[0-9]*$')
NOBODY=00000000-0000-4000-8000-000000000000
echo "del-photos:$DELPH"
echo "del-id:$GWN"
echo "gdel-anon:$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{\"ids\":[\"$GWN\"]}" "$P/api/v1/gowns/delete")"
echo "gdel-empty:$(api -X POST -d '{"ids":[]}' "$P/api/v1/gowns/delete")"
echo "gdel-too-many:$(api -X POST -d "{\"ids\":[$(for i in $(seq 1 101); do printf '"00000000-0000-4000-8000-%012d",' $i; done | sed 's/,$//')]}" "$P/api/v1/gowns/delete")"
echo "gdel:$(api -X POST -d "{\"ids\":[\"$GWN\",\"$NOBODY\"]}" "$P/api/v1/gowns/delete")"
echo "gdel-count:$(grep -o '"deleted":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
echo "gdel-missing:$(grep -c "\"missing\":\[\"$NOBODY\"\]" /tmp/o)"
echo "gdel-view:$(api "$P/api/v1/gowns/$GWN")"
echo "gdel-photo:$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $AT" "$P/api/v1/gowns/$GWN/photos/$GPH?size=thumb")"
echo "gdel-again:$(api -X POST -d "{\"ids\":[\"$GWN\"]}" "$P/api/v1/gowns/delete")"
echo "gdel-again-count:$(grep -o '"deleted":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
echo "gdel-gallery:$(api -X POST -d '{}' "$P/api/v1/gowns/query")"
echo "gdel-gallery-total:$(grep -o '"total":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
echo "gdel-audit:$(api "$P/api/v1/admin/audit")"
echo "gdel-audit-deleted:$(grep -o '"action":"gown_deleted"' /tmp/o | wc -l | tr -d ' ')"
# 6r. Assistant (Story 8.3): anonymous refused, empty text 422, a question is answered by the stub and costs one chat usage row, history keeps both lines, New chat empties it.
echo "chat-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/assistant/chat")"
echo "chat-empty:$(api -X POST -d '{"text":""}' "$P/api/v1/assistant/chat/messages")"
echo "chat-ask:$(api -X POST -d '{"text":"Summarize new inquiries SmokeAssistAskZq"}' "$P/api/v1/assistant/chat/messages")"
echo "chat-answer:$(grep -c 'SmokeAssistAnswerZq' /tmp/o)"
echo "chat-history:$(api "$P/api/v1/assistant/chat" >/dev/null; grep -o '"role":"' /tmp/o | wc -l | tr -d ' ')"
echo "chat-usage:$(api "$P/api/v1/admin/ai/usage" >/dev/null; grep -o '"purpose":"chat"' /tmp/o | wc -l | tr -d ' ')"
echo "chat-new:$(api -X DELETE "$P/api/v1/assistant/chat")"
echo "chat-cleared:$(api "$P/api/v1/assistant/chat" >/dev/null; grep -c '"messages":\[\]' /tmp/o)"
# 6s. Dashboard (Story 9.1): anonymous refused; Admin totals equal the Gallery total; the invited User's fields follow exactly the Permissions its own /me lists.
echo "dash-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/dashboard")"
echo "dash-admin:$(api "$P/api/v1/dashboard")"
echo "dash-total:$(grep -o '"totalGowns":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
echo "dash-recent:$(grep -c '"recentGowns":\[' /tmp/o)"
echo "dash-inquiries:$(grep -c '"inquiries":{' /tmp/o)"
echo "dash-ai:$(grep -c '"aiStatus":{"phase":' /tmp/o)"
echo "dash-errors:$(grep -c '"errors":\[\]' /tmp/o)"
echo "dash-gallery:$(api -X POST -d '{}' "$P/api/v1/gowns/query")"
echo "dash-gallery-total:$(grep -o '"total":[0-9]*' /tmp/o | grep -o '[0-9]*$')"
out logout-dash-admin
sign_in "$INVITEE" "${NEW_PW}-2" dash
api "$P/api/v1/me" >/dev/null; MEPERMS=$(cat /tmp/o)
echo "dash-user:$(api "$P/api/v1/dashboard")"
want_field() { # PERMISSION FIELD -> ok when the field is present exactly when the Permission is held
  has=0; echo "$MEPERMS" | grep -q "\"$1\"" && has=1
  seen=$(grep -c "\"$2\":" /tmp/o)
  [ "$has" = "$seen" ] && echo ok || echo "no($1=$has,$2=$seen)"
}
echo "dash-user-gowns:$(want_field PERM_VIEW_GALLERY recentGowns)"
echo "dash-user-total:$(want_field PERM_VIEW_GALLERY totalGowns)"
echo "dash-user-inquiries:$(want_field PERM_REPLY inquiries)"
echo "dash-user-ai:$(grep -c '"aiStatus":{"phase":"idle"' /tmp/o)"
# The invitee's Role is whichever the table lists first; the answer must follow its own /me Permissions (Staff 403 is in KeyRotationIT).
WANT=403; echo "$MEPERMS" | grep -q '"PERM_KEY_ROTATE"' && WANT=200
echo "keys-user:$([ "$(api "$P/api/v1/admin/keys/status")" = $WANT ] && echo ok || echo no)"
echo "keys-user-rewrap:$([ "$(api -X POST "$P/api/v1/admin/keys/rewrap")" = $WANT ] && echo ok || echo no)"
out logout-dash-user
sign_in "$KLEI_BOOTSTRAP_ADMIN_EMAIL" "$KLEI_BOOTSTRAP_ADMIN_PASSWORD" ai2
# 6t. Key custody (Story 9.2): Admin only; the stack runs on one KEK, so status counts one version and re-wrap has nothing to do; no key text in the answer.
echo "keys-anon:$(curl -s -o /dev/null -w "%{http_code}" "$P/api/v1/admin/keys/status")"
echo "keys-status:$(api "$P/api/v1/admin/keys/status")"
echo "keys-idle:$(grep -c '"run":{"state":"idle"' /tmp/o)"
echo "keys-configured:$(grep -c '"configured":\[' /tmp/o)"
echo "keys-rewrap:$(api -X POST "$P/api/v1/admin/keys/rewrap")"
echo "keys-rewrap-idle:$(grep -c '"state":"idle"' /tmp/o)"
out logout-ai
fi
EOF
  ) || fail "invite container failed"
  for want in invite:201 dupe:409 logout-admin:204 invite-mail:ok open:200 accept:200 code-mail:ok bad-code:400 verify:200 login-user:200 token-user:200 logout-user:204 login-before:200 token-before:200 forgot:200 forgot-unknown:200 reset-mail:ok reset-open:200 reset:200 reset-replay:410 old-access:401 old-refresh:401 login-oldpw:401 login-new:200 token-new:200 logout-new:204 login-prof:200 token-prof:200 login-prof2:200 token-prof2:200 prof-anon:401 prof-get:200 prof-no-if-match:400 prof-blank:422 prof-rename:200 prof-renamed:1 prof-stale:409 prof-me-name:1 avatar-none:404 pw-wrong:422 pw-weak:422 pw-change:204 pw-this-access:200 pw-this-refresh:200 logout-prof:204 pw-other-refresh:401 login-pwold:401 login-pwnew:200 token-pwnew:200 logout-pwnew:204 login-studio:200 token-studio:200 login-sig:200 token-sig:200 studio-anon:401 studio-get:200 studio-no-if-match:400 studio-too-many-lines:422 studio-put:200 studio-saved:1 studio-stale:409 logout-studio:204 sig-anon:401 sig-get:200 sig-blank:1 sig-no-if-match:400 sig-too-long:422 sig-put:200 sig-preview:1 sig-stale:409 sig-read-back:1 pref-anon:401 pref-get:200 pref-default:1 pref-no-if-match:400 pref-bad-zone:422 pref-put:200 pref-saved:1 pref-stale:409 pref-me:1 logout-sig:204 login-inq:200 token-inq:200 inq-anon:401 inq-count-0:1 inq-bad:422 inq-create-1:201 inq-replay:200 inq-replay-same:1 inq-create-2:201 inq-list:200 inq-listed:2 inq-newest-first:1 inq-closed-none:1 inq-count-2:1 inq-get:200 inq-get-body:1 inq-get-unread:1 inq-get-unknown:404 inq-get-kept-count:1 inq-read-anon:401 inq-read:204 inq-read-again:204 inq-read-count:1 inq-get-read:1 inq-client:200 inq-client-rows:2 inq-client-unknown:404 inq-draft-empty:1 inq-draft-put:200 inq-draft-get:1 inq-reply-anon:401 inq-reply-nokey:400 inq-reply-blank:422 inq-reply:201 inq-reply-sent:1 inq-reply-replay:200 inq-reply-replay-same:1 inq-reply-mail:ok inq-reply-one-mail:1 inq-reply-status:1 inq-reply-unread:1 inq-draft-gone:1 inq-reply-count:1 inq-retry-sent:409 inq-reply-listed:1 inq-status-nokey:400 inq-status-stale:409 inq-status-bad:422 inq-close:200 inq-closed-listed:1 inq-reply-closed:409 inq-reopen:200 inq-reopened:1 inq-client-nokey:400 inq-client-stale:409 inq-client-bad:422 inq-client-edit:200 inq-client-saved:1 notif-anon:401 notif-list:200 notif-invite:1 notif-unread:1 notif-read-empty:422 notif-read:204 notif-read-back:1 notif-clear:204 notif-cleared:1 search-anon:401 search-missing:422 search-punct:1 search-inquiry:1 logout-inq:204 login-staff:200 token-staff:200 s-list:200 s-listed:1 s-invite:201 s-no-if-match:400 s-stale:409 s-edit:200 s-resend:204 s-mail:ok s-delete:204 s-stale-after-delete:401 login-staff2:200 token-staff2:200 s-gone:404 logout-staff:204 logout-staff2:204 login-roles:200 token-roles:200 r-matrix:200 r-locked:1 r-no-if-match:400 r-admin-locked:422 r-change:200 r-stale-token:401 r-refresh:200 r-after:200 r-less:0 r-restore:200 a-page:200 a-roles-entry:2 a-newest-first:ok a-bad-page:422 a-write:405 logout-roles:204 login-audit:200 token-audit:200 logout-audit:204; do
    echo "$inv" | grep -qx "$want" || fail "invite flow: expected $want in: $(echo "$inv" | grep -v '^me:')"
  done
  for want in up-anon:401 up-open:200 up-photo:201 up-name-echo:0 up-retry:201 up-retry-same:ok up-text:415 up-text-echo:0 up-thumb:200 up-full:200 up-full-same:ok up-current:200 up-current-rejected:1 logout-upl:204; do
    echo "$inv" | grep -qx "$want" || fail "upload: expected $want in: $(echo "$inv" | grep '^up-\|-upl:')"
  done
  PHOTOS=1; DELPH=0; DELGWN=
  if [ "${KLEI_AI_DEV_MODE:-false}" = true ]; then
    DELPH=$(echo "$inv" | sed -n 's/^del-photos://p'); DELGWN=$(echo "$inv" | sed -n 's/^del-id://p')
    [ "$DELPH" -ge 1 ] || fail "the Gown to delete should have photos"
    PHOTOS=$((6 - DELPH))
  fi
  [ "$(q 'select count(*) from photo')" = "$PHOTOS" ] || fail "expected $PHOTOS photo rows (the retried upload counts once)"
  [ "$(q 'select count(*) from stored_object')" = "$((PHOTOS * 2))" ] || fail "one photo is two stored objects"
  LISTING=$(docker run --rm --network $NET $CURL_IMAGE -s --aws-sigv4 "aws:amz:us-east-1:s3" --user "$KLEI_S3_ACCESS_KEY:$KLEI_S3_SECRET_KEY" "http://objectstore:8333$B")
  KEYS=$(echo "$LISTING" | grep -o '<Key>[^<]*</Key>' | sed 's/<[^>]*>//g')
  [ "$(echo "$KEYS" | grep -c .)" = "$((PHOTOS * 2))" ] || fail "bucket should hold exactly $((PHOTOS * 2)) objects, listing: $KEYS"
  echo "$KEYS" | grep -vqE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' && fail "an object key is not a UUID: $KEYS"
  for k in $KEYS; do
    docker run --rm --network $NET $CURL_IMAGE -s --aws-sigv4 "aws:amz:us-east-1:s3" --user "$KLEI_S3_ACCESS_KEY:$KLEI_S3_SECRET_KEY" "http://objectstore:8333$B/$k" | grep -qa "SmokeJpegZq\|JFIF\|JPEG" && fail "object $k holds readable image bytes"
  done
  $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -q "SmokeUploadZq\|SmokeJpegZq\|SmokeGroupZq" && fail "upload file name or comment found in a database dump"
  ok "photo upload: batch opened, JPEG stored as two UUID-keyed encrypted objects, retry returns the same photo, text file refused with 415 and no name echoed, thumbnail and original read back, counts and dump clean"
  echo "$inv" | grep '^me:' | grep -qF "$INVITEE" || fail "GET /api/v1/me did not return the invited User after sign-in"
  [ "$(q 'select count(*) from client')" = 1 ] || fail "two inquiries from one address must make one client"
  [ "$(q 'select count(*) from inquiry')" = 2 ] || fail "expected two inquiries (the replayed key counts once)"
  [ "$(q 'select count(*) from message')" = 3 ] || fail "expected one first message per inquiry plus one reply"
  [ "$(q 'select count(*) from draft')" = 0 ] || fail "the reply must delete its draft"
  $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -q "SmokeRpZq" && fail "reply or draft text found in a database dump"
  [ "$(q 'select count(*) from inquiry_term')" -ge 3 ] || fail "each inquiry needs search terms"
  [ "$(q 'select count(*) from app_user')" = 2 ] || fail "expected two users after the invite and the staff round trip (the second one was deleted)"
  [ "$(q 'select count(*) from app_user where last_active_ct is not null')" -ge 2 ] || fail "sign-ins did not record last active"
  EDITED=$(echo "$inv" | sed -n 's/^edited://p')
  [ -n "$EDITED" ] && $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -qiE "$(echo "$EDITED" | sed 's/[.]/\\./g')|Smoke Three|Smoke Two" && fail "edited staff email or name found in a database dump"
  [ "$(q 'select count(*) from role_permission')" = 16 ] || fail "role permissions not restored after the roles round trip"
  [ "$(q 'select count(*) from auth_credential')" = 0 ] || fail "invite and verify credentials remain after use"
  [ "$(q 'select count(*) from refresh_token')" = 0 ] || fail "refresh tokens remain after logout"
  $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -qF "$INVITEE" && fail "invitee email found in a database dump"
  $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -qE "SmokeRenamedZq|SmokeStaleZq|SmokeSigNameZq|SmokeInqZq|SmokeAssistAskZq|SmokeAssistAnswerZq|SmokeCeZq|smoke-client-|SmokeStudioZq|SmokeStaleStudioZq|1 Smoke Lane|Asia/Tokyo|accepted the invite" && fail "profile, signature, preferences or studio text found in a database dump"
  if [ "${KLEI_AI_DEV_MODE:-false}" = true ]; then
    for want in login-ai:200 token-ai:200 ai-get:200 ai-no-if-match:400 ai-save:200 ai-key-echo:0 ai-key-set:1 ai-test:200 ai-test-ok:3 ai-test-status:1 ai-reread:200 ai-reread-key:0 ai-reread-status:1 ai-behavior:1 usage-get:200 usage-test-row:1 usage-no-bodies:0 usage-bad-page:422 tx-get:200 tx-seeds:19 tx-mikado:1 tx-add:200 tx-dupe:422 tx-no-if-match:400 tx-stale:409 tx-remove:200 tx-removed:0 chat-anon:401 chat-empty:422 chat-ask:201 chat-answer:1 chat-history:2 chat-usage:1 chat-new:204 chat-cleared:1 dash-anon:401 dash-admin:200 dash-recent:1 dash-inquiries:1 dash-ai:1 dash-errors:1 dash-gallery:200 dash-user:200 dash-user-gowns:ok dash-user-total:ok dash-user-inquiries:ok dash-user-ai:1 keys-user:ok keys-user-rewrap:ok keys-anon:401 keys-status:200 keys-idle:1 keys-configured:1 keys-rewrap:200 keys-rewrap-idle:1 logout-ai:204; do
      echo "$inv" | grep -qx "$want" || fail "AI settings: expected $want in: $(echo "$inv" | grep '^ai-\|-ai:')"
    done
    for want in grp-photo-2:201 grp-photo-3:201 grp-photo-4:201 grp-photo-5:201 grp-photo-6:201 grp-start:202 grp-phase:review grp-groups:3 grp-name-echo:0 grp-edit-no-if-match:400 grp-edit-stale:409 grp-edit:200 grp-edit-echo:1 grp-edit-bad:422 grp-mv-no-if-match:400 grp-mv:200 grp-mv-groups:4 grp-mv-stale:409 grp-discard:200 grp-discard-groups:3 grp-discard-again:404 grp-restore:200 grp-restore-groups:3 grp-start-again:409 grp-usage:200 save-anon:401 save-unknown:404 save:200 save-count:3 save-again:200 save-again-count:3 gal-anon:401 gal:200 gal-total:3 gal-cards:3 gal-week:200 gal-week-matching:3 gal-nomatch:200 gal-nomatch-matching:0 gal-bad-days:422 gal-thumb:200 gal-thumb-type:1 gal-thumb-nostore:1 gal-thumb-bytes:ok search-gown:1 view-anon:401 view:200 view-photos:ok view-band:1 view-full:200 view-full-type:1 view-full-nostore:1 view-unknown:404 gedit-anon:401 gedit-no-if-match:400 gedit:200 gedit-name:1 gedit-version:ok gedit-stale:409 gedit-bad:422 gedit-unknown:404 gedit-gallery:200 gedit-gallery-name:1 export-anon:401 export-empty:422 export:200 export-name:1 export-details:1 export-missing:1 export-too-many:413 save-gone:404 save-open:200 save-new-batch:ok save-up:201 save-discard:204 save-discard-again:404 save-audit:200 save-audit-saved:1 save-audit-discarded:1 gdel-anon:401 gdel-empty:422 gdel-too-many:422 gdel:200 gdel-count:1 gdel-missing:1 gdel-view:404 gdel-photo:404 gdel-again:200 gdel-again-count:0 gdel-gallery:200 gdel-gallery-total:2 gdel-audit:200 gdel-audit-deleted:1; do
      echo "$inv" | grep -qx "$want" || fail "grouping: expected $want in: $(echo "$inv" | grep '^grp-')"
    done
    DT=$(echo "$inv" | sed -n 's/^dash-total://p')
    [ -n "$DT" ] && [ "$DT" = "$(echo "$inv" | sed -n 's/^dash-gallery-total://p')" ] || fail "Dashboard total ($DT) differs from the Gallery total"
    [ "$(echo "$inv" | sed -n 's/^grp-usage-embeds://p')" -ge 6 ] || fail "usage list should show six embed calls"
    [ "$(echo "$inv" | sed -n 's/^grp-usage-describes://p')" -ge 3 ] || fail "usage list should show three describe calls"
    [ "$(echo "$inv" | sed -n 's/^grp-usage-verifies://p')" -ge 3 ] || fail "usage list should show three verify calls"
    echo "$inv" | grep -qx "grp-usage-desc-echo:0" || fail "usage list returned a description"
    [ "$(q 'select count(*) from embedding')" = 0 ] || fail "Save and Discard must leave no embedding behind"
    [ "$(q 'select count(*) from upload_group')" = 0 ] || fail "Save must delete the review groups"
    [ "$(q 'select count(*) from upload_batch')" = 0 ] || fail "no batch should remain after Save and Discard"
    [ "$(q 'select count(*) from gown')" = 2 ] || fail "three groups saved and one Gown deleted, two Gowns expected"
    [ "$(q 'select count(*) from gown_term')" -ge 3 ] || fail "each Gown needs search terms"
    [ "$(q 'select count(*) from photo where gown_id is not null and batch_id is null and group_id is null')" = "$PHOTOS" ] || fail "every kept photo belongs to a Gown and to no batch"
    for t in gown_term gown_attribute; do
      [ "$(q "select count(*) from $t where gown_id = '$DELGWN'")" = 0 ] || fail "the deleted Gown left rows in $t"
    done
    [ "$(q "select count(*) from photo where gown_id = '$DELGWN'")" = 0 ] || fail "the deleted Gown left photos"
    $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -qF "Group 1" && fail "group name found in a database dump"
    $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -qE "SmokeGownZq|SmokeDescZq|SmokeEditZq|SmokeEditDescZq|SmokeCedarZq|SmokeCedarDescZq|New group" && fail "gown name or description found in a database dump"
    $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -qF "smoke-stub-key" && fail "AI key found in a database dump"
    $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | grep -qF "ai-stub" && fail "AI base URL found in a database dump"
    [ "$(q 'select count(*) from taxonomy_value')" = 19 ] || fail "taxonomy should hold the 19 seeds after the add and remove round trip"
    DUMP=$($COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"')
    echo "$DUMP" | grep -qE "Mikado|Sweetheart|A-line|SmokeTaxZq" && fail "taxonomy text found in a database dump"
    ok "grouping: six photos started, polled to review, three groups, second start 409, six embed rows in the usage list; Save made three Gowns that the Gallery lists, windows, and serves a thumbnail and the full photo of, and a Gown read for the viewer (404 for an unknown one) of and cleared groups, vectors and batch, a repeated Save replays, a new batch discards cleanly, upload_saved and upload_discarded audited, names absent from pg_dump"
    ok "AI settings saved against ai-stub, key never returned, Test connection gives three green checks, key and URL absent from pg_dump; usage list shows the Test connection call and no prompt or response, bad page 422; taxonomy seeds read, add/duplicate/stale/remove behave, tag text absent from pg_dump"
  else
    ok "AI settings step skipped (KLEI_AI_DEV_MODE is not true; set it with SPRING_PROFILES_ACTIVE=dev to run it)"
  fi
  ok "invite mailed, A2 password set, A3 code verified, bad code refused, invited User signs in; forgot and reset (A4, A5) end old sessions, old password refused, new one signs in; no credential left; staff list, edit (If-Match), resend, delete; roles matrix read, Role change stales the old token, refresh keeps the sign-in, change restored; audit log page 1 newest first, bad page 422, no write route; inquiries: bad email 422, two from one address make one Client, replayed key answers 200 with the same Inquiry, list newest first, status filter, badge counts both, reading does not mark read, read clears it once for everyone and drops the badge, Client profile lists its Inquiries, Client and Inquiry data absent from pg_dump; invitee and edited staff data absent from pg_dump"
fi

# 7. A missing required variable stops the boot and names it, never a value.
miss=$(docker run --rm --entrypoint java -e KLEI_DB_URL=x klei-backend:dev -jar /app/klei.jar 2>&1 || true)
echo "$miss" | grep -q "code=missing_variable variables=KLEI_DB_USER" || fail "boot did not name the missing variable: $miss"
ok "boot stops naming the missing variable"

# 8. Backup and restore safety (Story 9.4): backup.sh on this stack, a dump and bucket free of plaintext, a deleted object reported, a wrong KEK stops the boot by name.
BK=$(mktemp -d "${TMPDIR:-/tmp}/klei-bk.XXXXXX")
trap 'rm -rf "$BK" "${ENVF:-}"' EXIT
KLEI_BACKUP_TARGET="$BK" infra/ops/backup.sh > /tmp/backup-1.log 2>&1 || fail "backup.sh failed: $(tail -5 /tmp/backup-1.log)"
grep -q "integrity: stored_object rows=[0-9]* bucket objects=[0-9]* missing=0" /tmp/backup-1.log || fail "backup integrity line missing or not zero: $(tail -3 /tmp/backup-1.log)"
F=$(ls -d "$BK"/klei-* | head -1)
[ -s "$F/db.dump" ] || fail "backup has no db.dump"
ROWS=$(sed -n 's/^integrity: stored_object rows=\([0-9]*\).*/\1/p' /tmp/backup-1.log)
if [ "${KLEI_AI_DEV_MODE:-false}" = true ]; then [ "$ROWS" -gt 0 ] || fail "the run stored photos, so the backup should list stored objects"; fi
$COMPOSE exec -T postgres pg_restore -f - < "$F/db.dump" | grep -qE "SmokeRenamedZq|SmokeStaleZq|SmokeSigNameZq|SmokeInqZq|SmokeAssistAskZq|SmokeAssistAnswerZq|SmokeCeZq|smoke-client-|SmokeStudioZq|1 Smoke Lane|SmokeGownZq|SmokeEditZq|SmokeCedarZq|SmokeTaxZq|smoke-stub-key|ai-stub|Mikado|Sweetheart" && fail "plaintext found in the backup dump"
[ -n "${KLEI_BOOTSTRAP_ADMIN_EMAIL:-}" ] && { $COMPOSE exec -T postgres pg_restore -f - < "$F/db.dump" | grep -qF "$KLEI_BOOTSTRAP_ADMIN_EMAIL" && fail "Admin email found in the backup dump"; }
for o in "$F"/bucket/*; do
  [ -e "$o" ] || break
  [ "$(head -c3 "$o" | od -An -tx1 | tr -d ' \n')" = ffd8ff ] && fail "a bucket object in the backup starts like a JPEG"
done
ok "backup.sh wrote a dump and a bucket copy with zero missing objects; no sentinel, Admin email or JPEG header in them"

# The restore drill reuses the clean backup (infra/ops/restore.md): KLEI_SMOKE_KEEP_BACKUP=<empty folder> copies it out before the trap removes it.
[ -z "${KLEI_SMOKE_KEEP_BACKUP:-}" ] || cp -R "$F" "$KLEI_SMOKE_KEEP_BACKUP/"

# One stored object removed from the bucket: the report must name the count and the exit must be 3.
GONE=$(ls -1 "$F/bucket" | head -1)
if [ -n "$GONE" ]; then
  expect "$(s3 "$KLEI_S3_ACCESS_KEY" "$KLEI_S3_SECRET_KEY" DELETE "$B/$GONE")" 204 "delete one bucket object"
  set +e; KLEI_BACKUP_TARGET="$BK" infra/ops/backup.sh > /tmp/backup-2.log 2>&1; rc=$?; set -e
  [ "$rc" = 3 ] || fail "backup with a missing object should exit 3, got $rc: $(tail -3 /tmp/backup-2.log)"
  grep -q "missing=1" /tmp/backup-2.log || fail "integrity line should say missing=1"
  grep -qx "$GONE" "$(ls -d "$BK"/klei-* | tail -1)/missing.txt" || fail "missing.txt should list the removed object"
  ok "a removed bucket object gives exit 3, missing=1 and its id in missing.txt"
fi

# A restore with the wrong KEK value: the backend stops, names the variable, never prints a value.
BID=$($COMPOSE ps -q backend)
ENVF=$(mktemp "${TMPDIR:-/tmp}/klei-env.XXXXXX"); chmod 600 "$ENVF"
WRONG=$(head -c 32 /dev/urandom | base64)
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$BID" | grep -E '^(KLEI_|SPRING_|JAVA_)' | grep -v '^KLEI_KEK_1=' > "$ENVF"
echo "KLEI_KEK_1=$WRONG" >> "$ENVF"
bad=$(docker run --rm --network $NET --env-file "$ENVF" --entrypoint java klei-backend:dev -jar /app/klei.jar 2>&1 || true)
echo "$bad" | grep -q "klei startup stopped: code=wrong_kek variables=KLEI_KEK_1" || fail "wrong KEK did not stop the boot by name: $(echo "$bad" | tail -5)"
echo "$bad" | grep -qF "$WRONG" && fail "the wrong KEK value was printed"
ok "boot with a wrong KEK_1 stops naming KLEI_KEK_1, no value printed"

echo "SMOKE PASS"
