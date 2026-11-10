#!/bin/sh
# Backend pipeline step (architecture §9.4): build, unit tests, ArchUnit, integration tests. Needs JDK 25 and Docker.
set -eu
cd "$(dirname "$0")/../../backend"
exec ./mvnw -B -ntp verify
