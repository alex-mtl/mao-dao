#!/bin/sh
# The file exchange folder on aws-dev (see ../API.md, "Файлы"). Run once with sudo; safe to run again.
#   sudo sh setup-exchange.sh
# - /srv/ai-exchange = a 1 GB ext4 image (/var/lib/ai-exchange.img) mounted with a loop device: it can never take
#   more than 1 GB of the server's disk;
# - files live in /srv/ai-exchange/files (owner ubuntu, group-writable). Druzhok uses his own server access
#   (owner's decision, 2026-10-27: no separate restricted user);
# - files older than 7 days are deleted daily.
set -eu
IMG=/var/lib/ai-exchange.img
MNT=/srv/ai-exchange

if [ ! -f "$IMG" ]; then
  fallocate -l 1G "$IMG"
  chmod 600 "$IMG"
  mkfs.ext4 -q -m 0 "$IMG"
fi
mkdir -p "$MNT"
grep -q "^$IMG " /etc/fstab || echo "$IMG $MNT ext4 loop,nodev,nosuid,noexec 0 2" >> /etc/fstab
mountpoint -q "$MNT" || mount "$MNT"
install -d -o ubuntu -g ubuntu -m 2775 "$MNT/files"

cat > /etc/cron.daily/ai-exchange <<'EOC'
#!/bin/sh
find /srv/ai-exchange/files -mindepth 1 -type f -mtime +7 -delete
find /srv/ai-exchange/files -mindepth 1 -type d -empty -delete
EOC
chmod 755 /etc/cron.daily/ai-exchange

df -h "$MNT" | tail -1
