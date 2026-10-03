#!/bin/bash
# Runs Homebase in the background on macOS, using launchd: it starts with the computer (before
# anyone signs in) and comes back if it ever stops.
#
# From Terminal in the Homebase folder (not with sudo; it asks for your password when it needs it):
#   npm run service -- install     set it up and start it
#   npm run service -- status      is it running?
#   npm run service -- restart     after pulling updates and running npm run build
#   npm run service -- stop        stop it until the next restart or reboot
#   npm run service -- uninstall   remove it (your data stays)
#
# PORT, HOST, HOMEBASE_DB, HOMEBASE_VAPID_SUBJECT, HOMEBASE_BACKUP_DIR and HOMEBASE_BACKUP_KEEP set
# in this shell when you install are remembered for the service. It runs as the user who installs it.
set -euo pipefail

label='homebase'
plist="/Library/LaunchDaemons/$label.plist"
root="$(cd "$(dirname "$0")/.." && pwd)"
data="$root/server/data"
log="$data/homebase.log"
action="${1:-status}"

fail() { echo "$1" >&2; exit 1; }

# The port the service uses: from its saved settings, else this shell, else 8080.
port=8080
if [ -f "$plist" ]; then
  saved="$(plutil -extract EnvironmentVariables.PORT raw -o - "$plist" 2>/dev/null || true)"
  [ -n "$saved" ] && port="$saved"
fi
if [ "$action" = install ] && [ -n "${PORT:-}" ]; then port="$PORT"; fi

loaded() { sudo launchctl print "system/$label" >/dev/null 2>&1; }

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

case "$action" in
  install)
    [ "$(id -u)" -ne 0 ] || fail 'Run this without sudo, from your own account. It asks for your password when it needs it.'
    node="$(command -v node || true)"
    [ -n "$node" ] || fail 'Node.js was not found. Install Node 22.18 or newer, then open a new Terminal window.'
    "$node" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' ||
      fail "Homebase needs Node 22.18 or newer; this computer has $("$node" -v)."
    [ -f "$root/web/dist/index.html" ] || fail 'Build the app first: npm install, then npm run build.'
    [ -d "$root/node_modules" ] || fail 'Install the packages first: npm install.'
    mkdir -p "$data"

    # launchd starts the job without this shell's settings, so write them into its plist.
    env=''
    for name in PORT HOST HOMEBASE_DB HOMEBASE_VAPID_SUBJECT HOMEBASE_BACKUP_DIR HOMEBASE_BACKUP_KEEP; do
      value="${!name:-}"
      [ -n "$value" ] && env+="    <key>$name</key><string>$(xml "$value")</string>"$'\n'
    done
    tmp="$(mktemp)"
    cat > "$tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml "$root/scripts/run.sh")</string>
    <string>$(xml "$node")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$root")</string>
  <key>UserName</key><string>$(xml "$(id -un)")</string>
  <key>EnvironmentVariables</key>
  <dict>
$env  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
EOF
    plutil -lint "$tmp" >/dev/null || { rm -f "$tmp"; fail 'Could not write the service settings. Check the values of the settings above for unusual characters.'; }

    echo 'Installing the Homebase service. macOS may ask for your password.'
    if loaded; then sudo launchctl bootout "system/$label" 2>/dev/null || true; fi
    sudo install -m 644 -o root -g wheel "$tmp" "$plist"
    rm -f "$tmp"
    sudo launchctl bootstrap system "$plist"
    echo "Homebase is installed and starting. In a few seconds, open http://localhost:$port"
    echo "It now starts whenever the computer does. Log: $log"
    ;;
  uninstall)
    if loaded; then sudo launchctl bootout "system/$label" 2>/dev/null || true; fi
    [ -f "$plist" ] && sudo rm -f "$plist"
    echo 'Homebase no longer runs in the background. Your data and backups are still in server/data.'
    ;;
  stop)
    [ -f "$plist" ] || fail 'Homebase is not installed as a background service. Run: npm run service -- install'
    if loaded; then sudo launchctl bootout "system/$label" 2>/dev/null || true; fi
    echo 'Homebase is stopped. It starts again at the next reboot, or with: npm run service -- restart'
    ;;
  restart)
    [ -f "$plist" ] || fail 'Homebase is not installed as a background service. Run: npm run service -- install'
    if loaded; then
      sudo launchctl kickstart -k "system/$label"
    else
      sudo launchctl bootstrap system "$plist"
    fi
    echo "Restarted. Open http://localhost:$port in a few seconds."
    ;;
  status)
    if [ ! -f "$plist" ]; then echo 'Homebase is not installed as a background service. Run: npm run service -- install'; exit 0; fi
    if launchctl print "system/$label" >/dev/null 2>&1; then
      echo "Service: $(launchctl print "system/$label" 2>/dev/null | sed -n 's/^[[:space:]]*state = //p' | head -n 1)"
    else
      echo 'Service: stopped (npm run service -- restart starts it)'
    fi
    if health="$(curl -fsS --max-time 5 "http://localhost:$port/api/health" 2>/dev/null)"; then
      screens="$(printf '%s' "$health" | sed -n 's/.*"liveClients":\([0-9]*\).*/\1/p')"
      echo "Homebase is answering on http://localhost:$port (${screens:-0} screens connected)."
    else
      echo "Homebase is not answering on port $port. The end of the log may say why: $log"
    fi
    ;;
  *)
    fail "Unknown action: $action. Use install, status, restart, stop or uninstall."
    ;;
esac
