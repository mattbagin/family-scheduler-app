#!/bin/bash
# Started by the Homebase launchd job (see service.sh) with the path to node. Runs the server and
# appends its output to server/data/homebase.log (moving an old log aside past 10 MB). When the
# server stops, launchd starts this again after 10 seconds.
root="$(cd "$(dirname "$0")/.." && pwd)"
node="${1:-node}"
log="$root/server/data/homebase.log"
cd "$root" || exit 1

if [ -f "$log" ] && [ "$(stat -f %z "$log")" -gt 10485760 ]; then mv -f "$log" "$log.old"; fi
echo "[$(date '+%Y-%m-%dT%H:%M:%S')] Starting Homebase" >> "$log"
"$node" --disable-warning=ExperimentalWarning server/src/index.ts >> "$log" 2>&1
code=$?
echo "[$(date '+%Y-%m-%dT%H:%M:%S')] Homebase stopped (exit code $code). Starting it again in 10 seconds." >> "$log"
exit "$code"
