#!/bin/bash
# Copies the engine's per-LIVE logs and cached avatars to Cloudflare R2 (bucket stream-logs); the data folder is only read.
#   lives-to-r2.sh          new or changed files since the last run (state: ~/.cache/lives-to-r2.state)
# rooms/<room>/lives/<file>.jsonl -> lives/<room>/<file>.jsonl.xz  (only files untouched for 60 min: the LIVE is over)
# avatars/<uid>.<ext>             -> avatars/<uid>.<ext>           (latest picture; the engine refreshes them weekly)
# Cron: 40 0 * * * (see README.md).
set -euo pipefail
set -a; . "$HOME/.config/r2-stream-logs.env"; set +a
DATA=/var/lib/guessword-engine
R2="$(dirname "$0")/r2.py"
STATE="$HOME/.cache/lives-to-r2.state"
mkdir -p "$(dirname "$STATE")"; touch "$STATE"
up=0; failed=0
while IFS=$'\t' read -r path size; do
  case "$path" in
    */lives/*) rest=${path#$DATA/rooms/}; key="lives/${rest%%/*}/${path##*/}.xz" ;;
    *) key="avatars/${path##*/}" ;;
  esac
  grep -qxF "$key $size" "$STATE" && continue
  tmp=$(mktemp)
  case "$key" in *.xz) sudo cat "$path" | xz -9 > "$tmp" ;; *) sudo cat "$path" > "$tmp" ;; esac
  if python3 "$R2" put "$tmp" "$key" 2>/dev/null; then
    grep -v "^$key " "$STATE" > "$STATE.new" || true; echo "$key $size" >> "$STATE.new"; mv "$STATE.new" "$STATE"; up=$((up + 1))
  else
    echo "FAILED $key"; failed=$((failed + 1))
  fi
  rm -f "$tmp"
done < <(sudo find "$DATA/rooms" -path '*/lives/*.jsonl' -mmin +60 -printf '%p\t%s\n'; \
         sudo find "$DATA/avatars" -type f -printf '%p\t%s\n' 2>/dev/null)
echo "$(date -u +%FT%TZ) uploaded $up, failed $failed"
[ $failed = 0 ]
