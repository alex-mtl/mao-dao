#!/bin/bash
# Daily archive of the stream engine's journal (guessword-engine: every game event of every room) to Cloudflare R2.
#   journal-to-r2.sh [YYYY-MM-DD ...]   default: yesterday (UTC)
# One object per UTC day: guessword-engine/YYYY/YYYY-MM-DD.log.xz (whole journal text, ~2.3 MB/day compressed).
# Only reads the journal; the temp file is removed. Credentials: ~/.config/r2-stream-logs.env (R2_ENDPOINT,
# R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY). Cron: 30 0 * * * (see README.md).
set -euo pipefail
set -a
. "$HOME/.config/r2-stream-logs.env"
UNIT=guessword-engine
days=("$@")
[ ${#days[@]} -eq 0 ] && days=("$(date -u -d yesterday +%F)")
for d in "${days[@]}"; do
  tmp=$(mktemp)
  sudo journalctl -u "$UNIT" --since "$d 00:00:00 UTC" --until "$(date -u -d "$d +1 day" +%F) 00:00:00 UTC" \
    --no-pager -o short-iso | xz -9 > "$tmp"
  ok=0; python3 "$(dirname "$0")/r2.py" put "$tmp" "$UNIT/${d:0:4}/$d.log.xz" 2>/dev/null || ok=$?
  echo "$d $(stat -c %s "$tmp") bytes -> $([ $ok = 0 ] && echo ok || echo FAILED)"
  rm -f "$tmp"
  [ $ok = 0 ] || exit 1
done
