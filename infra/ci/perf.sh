#!/bin/sh
# Story 9.4: NFR-2 benchmark. Seeds a workspace through the app's own services (test profile, encrypted like production),
# times the Gallery, search, Inbox, thread, viewer and Dashboard reads, prints a p95 table and exits non-zero on a miss.
#   infra/ci/perf.sh                 5,000 Gowns x 4 Photos, 5,000 Inquiries (PR gate)
#   infra/ci/perf.sh --scale full    10,000 Gowns x 10 Photos, 50,000 Inquiries (by hand before a release that touches queries)
# Needs Docker (Testcontainers starts PostgreSQL) and JDK 25. Report: backend/app/target/perf-report.txt
set -eu

cd "$(dirname "$0")/../../backend"
GOWNS=5000 PHOTOS=4 INQUIRIES=5000
case "${1:-}" in
  "") ;;
  --scale) [ "${2:-}" = full ] || { echo "usage: perf.sh [--scale full]" >&2; exit 2; }; GOWNS=10000 PHOTOS=10 INQUIRIES=50000 ;;
  *) echo "usage: perf.sh [--scale full]" >&2; exit 2 ;;
esac

rm -f app/target/perf-report.txt
./mvnw -B -ntp -q verify -pl app -am \
  -Dklei.perf=true -Dklei.perf.gowns="$GOWNS" -Dklei.perf.photos="$PHOTOS" -Dklei.perf.inquiries="$INQUIRIES" \
  -Dit.test=PerfIT -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  || { [ -f app/target/perf-report.txt ] && cat app/target/perf-report.txt; echo "PERF FAIL" >&2; exit 1; }
cat app/target/perf-report.txt
echo "PERF PASS"
