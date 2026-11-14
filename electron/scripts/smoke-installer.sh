#!/usr/bin/env bash
# Installs (or mounts) one installer from release/ and smoke-launches the app inside it; exits 0 only if the app does (19.3, 19.4).
# Run from electron/ after `npm run pack`. Usage: bash scripts/smoke-installer.sh <mac-arm64.dmg|mac-x64.dmg|win-x64.exe|linux-x64.AppImage|linux-x64.deb>
set -euo pipefail

kind=${1:-}
files=(release/klei-bridal-preview-*-"$kind")
[ -n "$kind" ] && [ -f "${files[0]}" ] || { echo "no installer for '$kind' in release/"; exit 1; }
img=${files[0]}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
no_scheme() { ! grep -q 'x-scheme-handler' "$1" || { echo "$1 declares a URL scheme"; exit 1; }; }

case "$kind" in
  mac-*.dmg)
    mkdir "$tmp/mnt"
    hdiutil attach -nobrowse -readonly -mountpoint "$tmp/mnt" "$img" >/dev/null
    ditto "$tmp/mnt/Klei Bridal Preview.app" "$tmp/Klei Bridal Preview.app"
    hdiutil detach "$tmp/mnt" >/dev/null
    node scripts/smoke.mjs "$tmp/Klei Bridal Preview.app/Contents/MacOS/Klei Bridal Preview"
    ;;
  win-x64.exe)
    MSYS_NO_PATHCONV=1 "$img" /S
    exe=""
    for _ in $(seq 30); do
      exe=$(find "$(cygpath -u "$LOCALAPPDATA")/Programs" -name 'Klei Bridal Preview.exe' 2>/dev/null | head -1)
      [ -n "$exe" ] && break
      sleep 2
    done
    [ -n "$exe" ] || { echo "installed app not found"; exit 1; }
    # The installer may start the app itself; a second copy would hit the single-instance lock and exit 0 without proving anything.
    taskkill //F //IM "Klei Bridal Preview.exe" 2>/dev/null || true
    if reg query 'HKCU\Software\Classes\klei' >/dev/null 2>&1; then echo "installer registered a klei URL scheme"; exit 1; fi
    node scripts/smoke.mjs "$(cygpath -w "$exe")"
    ;;
  linux-x64.AppImage)
    abs="$(cd "$(dirname "$img")" && pwd)/$(basename "$img")"
    chmod +x "$abs"
    (cd "$tmp" && "$abs" --appimage-extract >/dev/null)
    no_scheme "$(ls "$tmp"/squashfs-root/*.desktop | head -1)"
    # No FUSE on a CI runner, so the AppImage unpacks itself; --no-sandbox only here, an AppImage cannot carry the setuid helper.
    xvfb-run -a node scripts/smoke.mjs "$abs" --appimage-extract-and-run --no-sandbox
    ;;
  linux-x64.deb)
    sudo dpkg -i "$img" || sudo apt-get install -f -y
    pkg=$(dpkg-deb -f "$img" Package)
    desktop=$(dpkg -L "$pkg" | grep '\.desktop$' | head -1)
    [ -n "$desktop" ] || { echo "no .desktop file in the package"; exit 1; }
    no_scheme "$desktop"
    bin=$(dpkg -L "$pkg" | while IFS= read -r f; do [ -f "$f" ] && [ -x "$f" ] && [ "$(basename "$f")" = "$pkg" ] && { echo "$f"; break; }; done)
    [ -n "$bin" ] || { echo "no executable named $pkg in the package"; exit 1; }
    xvfb-run -a node scripts/smoke.mjs "$bin"
    ;;
  *)
    echo "unknown installer kind: $kind"
    exit 1
    ;;
esac
