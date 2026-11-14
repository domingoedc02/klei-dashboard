#!/usr/bin/env bash
# Publishes one Electron preview release into the download site's data folder over SSH (19.4). CI only.
#   deploy.sh check <version>                  fail early if the site is unreachable, the host key differs, or the version already exists
#   deploy.sh upload <version> <dir>           copy this runner's installers from <dir> into <path>/.<version>.part/
#   deploy.sh finish <version> <release.json>  check names and SHA-256 there, add release.json last, rename to <path>/<version>
# Env: ELECTRON_DEPLOY_HOST, _USER, _KEY, _KNOWN_HOSTS (secrets) and ELECTRON_DEPLOY_PATH (variable). Their values are never printed.
# The host key comes only from ELECTRON_DEPLOY_KNOWN_HOSTS and is always checked. rsync is used when present, scp otherwise (the Windows runner has none).
set -euo pipefail

die() { echo "deploy: $1" >&2; exit 1; }
cmd=${1:-}
version=${2:-}
arg=${3:-}
[[ "$cmd" == check || "$cmd" == upload || "$cmd" == finish ]] || die "usage: deploy.sh check <version> | upload <version> <dir> | finish <version> <release.json>"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "bad version"
for n in HOST USER KEY KNOWN_HOSTS PATH; do
  v="ELECTRON_DEPLOY_$n"
  [ -n "${!v:-}" ] || die "$v is not set"
done
[[ "$ELECTRON_DEPLOY_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "ELECTRON_DEPLOY_HOST has unexpected characters"
[[ "$ELECTRON_DEPLOY_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || die "ELECTRON_DEPLOY_USER has unexpected characters"
[[ "$ELECTRON_DEPLOY_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "ELECTRON_DEPLOY_PATH must be an absolute path of letters, digits, . _ - /"

umask 077
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
printf '%s\n' "$ELECTRON_DEPLOY_KEY" > "$tmp/key"
printf '%s\n' "$ELECTRON_DEPLOY_KNOWN_HOSTS" > "$tmp/known_hosts"
chmod 600 "$tmp/key" "$tmp/known_hosts"

ssh_opts=(-i "$tmp/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$tmp/known_hosts")
target="$ELECTRON_DEPLOY_USER@$ELECTRON_DEPLOY_HOST"
root="${ELECTRON_DEPLOY_PATH%/}"
part="$root/.$version.part"
final="$root/$version"

remote() { ssh "${ssh_opts[@]}" "$target" "$@"; }

send() {
  if command -v rsync >/dev/null 2>&1; then
    rsync -t -e "ssh ${ssh_opts[*]}" -- "$@" "$target:$part/"
  else
    scp "${ssh_opts[@]}" -- "$@" "$target:$part/"
  fi
}

# Never overwrite a published version; a failed connection is not "does not exist".
refuse_existing() {
  local rc=0
  remote "test -e '$final'" || rc=$?
  case $rc in
    1) ;;
    0) die "version $version already exists on the site; nothing was changed" ;;
    *) die "could not reach the site (ssh exit $rc)" ;;
  esac
}

case "$cmd" in
  check)
    refuse_existing
    echo "site reachable; $version does not exist yet"
    ;;
  upload)
    shopt -s nullglob
    files=()
    for f in "$arg"/klei-bridal-preview-"$version"-*; do
      case "$f" in *-mac-arm64.dmg | *-mac-x64.dmg | *-win-x64.exe | *-linux-x64.AppImage | *-linux-x64.deb) files+=("$f") ;; esac
    done
    [ ${#files[@]} -ge 1 ] || die "no installers for $version in $arg"
    refuse_existing
    remote "mkdir -p '$part' && chmod 755 '$part'" || die "could not create the staging folder"
    send "${files[@]}" || die "upload failed"
    remote "chmod 644 '$part'/klei-bridal-preview-*" || die "could not set permissions"
    echo "uploaded ${#files[@]} installer(s) to the staging folder"
    ;;
  finish)
    [ -f "$arg" ] && [ "$(basename "$arg")" = release.json ] || die "second argument must be a file named release.json"
    sums=$(node "$(dirname "$0")/release-manifest.mjs" sums "$arg")
    names=$(printf '%s\n' "$sums" | awk '{print $2}' | sort)
    refuse_existing
    have=$(remote "ls -A '$part'" | sort) || die "staging folder is missing"
    [ "$have" = "$names" ] || die "the staging folder does not hold exactly the installers release.json lists"
    printf '%s\n' "$sums" | remote "cd '$part' && sha256sum -c --quiet -" || die "an uploaded file differs from its recorded SHA-256"
    send "$arg" || die "could not upload release.json"
    remote "chmod 644 '$part/release.json' && test ! -e '$final' && mv '$part' '$final'" || die "could not publish the version folder"
    echo "published $version"
    ;;
esac
