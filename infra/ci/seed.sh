#!/usr/bin/env sh
# Dev-only demo data (Story 7.1): a few Inquiries entered through the API as the bootstrap Admin. No production seed.
# Needs the dev stack up with the backend reachable (default http://localhost:8080 and Auth Web on 8081) and these variables:
#   KLEI_BOOTSTRAP_ADMIN_EMAIL, KLEI_BOOTSTRAP_ADMIN_PASSWORD, and an access token in KLEI_TOKEN (sign in through the desktop app or infra/ci/smoke.sh's sign_in).
# shortcut: takes a ready access token instead of driving the PKCE sign-in; add a sign-in helper when a second script needs one.
set -eu
API=${KLEI_API:-http://localhost:8080}
: "${KLEI_TOKEN:?set KLEI_TOKEN to a signed-in access token}"
post() {
  curl -s -o /dev/null -w "%{http_code} $1\n" -H "Authorization: Bearer $KLEI_TOKEN" -H "Content-Type: application/json" \
    -H "Idempotency-Key: seed-$2" -d "$3" "$API/api/v1/inquiries"
}
post "Ana Rivera"   ana-1  '{"clientName":"Ana Rivera","clientEmail":"ana.rivera@example.test","subject":"Fitting in June","body":"Hello, I would like to book a fitting for early June. I am looking at A-line gowns with lace."}'
post "Mara Lindqvist" mara-1 '{"clientName":"Mara Lindqvist","clientEmail":"mara.lindqvist@example.test","subject":"Veil length","body":"Could you tell me which veils go with the Mermaid gowns you showed last week?"}'
post "Ana Rivera"   ana-2  '{"clientName":"Ana Rivera","clientEmail":"ana.rivera@example.test","subject":"Alterations timeline","body":"How long do alterations take if the wedding is on 14 September?"}'
post "Jun Park"     jun-1  '{"clientName":"Jun Park","clientEmail":"jun.park@example.test","subject":"Sleeves","body":"Do you have long-sleeve options in tulle?"}'
