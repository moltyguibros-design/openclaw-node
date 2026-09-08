#!/usr/bin/env bash
# build-launcher-app.sh — the double-clickable stack starter (macOS).
#
# Compiles a tiny AppleScript applet that runs `openclaw-stack up` headless,
# gives it the OpenClaw claw icns, ad-hoc signs it, and registers it. Drag it
# to the Dock; one click brings the whole node up and the result arrives as a
# ledgered notification (click-through to Mission Control diagnostics).
#
# Usage: build-launcher-app.sh [dest-app-path]
# Default dest: ~/Applications/OpenClaw Stack.app

set -euo pipefail

[ "$(uname -s)" = "Darwin" ] || { echo "not macOS — skipping launcher app build" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
ICNS="${REPO}/services/notify-icons/openclaw.icns"
STACK="${REPO}/bin/openclaw-stack.mjs"
[ -f "${STACK}" ] || { echo "missing ${STACK}" >&2; exit 1; }

NODE="$(command -v node 2>/dev/null || true)"
[ -z "${NODE}" ] && [ -x /opt/homebrew/bin/node ] && NODE=/opt/homebrew/bin/node
[ -z "${NODE}" ] && [ -x /usr/local/bin/node ]    && NODE=/usr/local/bin/node
[ -n "${NODE}" ] || { echo "node not found" >&2; exit 1; }

DEST="${1:-$HOME/Applications/OpenClaw Stack.app}"
mkdir -p "$(dirname "${DEST}")" "$HOME/.openclaw/logs"
rm -rf "${DEST}"

# Two steps, so one double-click both STARTS the node and SHOWS it: bring the
# stack up (logged), then wait for Mission Control to answer and open it. Without
# the second step the app looked like it did nothing at all.
START="do shell script \"'${NODE}' '${STACK}' up >> \" & quoted form of (POSIX path of (path to home folder)) & \".openclaw/logs/stack-launcher.log 2>&1 || true\""
OPEN_MC="do shell script \"for i in 1 2 3 4 5 6 7 8 9 10 11 12; do /usr/bin/curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:3000 && break; /bin/sleep 1; done; /usr/bin/open http://127.0.0.1:3000\""
osacompile -o "${DEST}" -e "${START}" -e "${OPEN_MC}"

if [ -f "${ICNS}" ]; then
  cp "${ICNS}" "${DEST}/Contents/Resources/applet.icns"
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ai.openclaw.stack-launcher" "${DEST}/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string ai.openclaw.stack-launcher" "${DEST}/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName OpenClaw Stack" "${DEST}/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleName string OpenClaw Stack" "${DEST}/Contents/Info.plist"

codesign --force --deep --sign - "${DEST}" >/dev/null 2>&1 || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "${DEST}" >/dev/null 2>&1 || true

# A shortcut nobody can find is not a shortcut: ~/Applications does not show in
# Launchpad reliably, so also drop it on the Desktop (a symlinked .app keeps its
# icon and double-click behaviour).
DESKTOP_LINK="$HOME/Desktop/OpenClaw Stack.app"
if [ -d "$HOME/Desktop" ]; then
  rm -rf "${DESKTOP_LINK}"
  ln -sfn "${DEST}" "${DESKTOP_LINK}" 2>/dev/null && echo "desktop shortcut: ${DESKTOP_LINK}"
fi

echo "launcher ready: ${DEST}"
echo "Double-click it (Desktop or Dock) → stack up → Mission Control opens."
