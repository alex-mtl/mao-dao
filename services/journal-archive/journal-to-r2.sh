#!/bin/bash
# Daily archive of the stream engine's journal (guessword-engine: every game event of every room) to Cloudflare R2.
#   journal-to-r2.sh [YYYY-MM-DD ...]   default: yesterday (UTC)
# One object per UTC day: guessword-engine/YYYY/YYYY-MM-DD.log.xz (whole journal text, ~2.3 MB/day compressed).
# Only reads the journal; the temp file is removed. Credentials: ~/.config/r2-stream-logs.env (R2_ENDPOINT,
# R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY). Cron: 30 0 * * * (see README.md).
set -euo pipefail
. "$HOME/.config/r2-stream-logs.env"
UNIT=guessword-engine
days=("$@")
[ ${#days[@]} -eq 0 ] && days=("$(date -u -d yesterday +%F)")
for d in "${days[@]}"; do
  tmp=$(mktemp)
  sudo journalctl -u "$UNIT" --since "$d 00:00:00 UTC" --until "$(date -u -d "$d +1 day" +%F) 00:00:00 UTC" \
    --no-pager -o short-iso | xz -9 > "$tmp"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --aws-sigv4 "aws:amz:auto:s3" \
    --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" -T "$tmp" "$R2_ENDPOINT/$R2_BUCKET/$UNIT/${d:0:4}/$d.log.xz")
  echo "$d $(stat -c %s "$tmp") bytes -> $code"
  rm -f "$tmp"
  [ "$code" = 200 ] || exit 1
done
