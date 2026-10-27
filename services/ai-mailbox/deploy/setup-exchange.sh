#!/bin/sh
# The file exchange folder on aws-dev (see ../API.md, "Файлы"). Run once with sudo; safe to run again.
#   sudo sh setup-exchange.sh "<Druzhok's SSH public key>"
# - /srv/ai-exchange = a 1 GB ext4 image (/var/lib/ai-exchange.img) mounted with a loop device: it can never take
#   more than 1 GB of the server's disk;
# - files live in /srv/ai-exchange/files (group aiex: ubuntu + druzhok);
# - user druzhok: SFTP / SCP only, locked (chroot) into /srv/ai-exchange, no shell, key login only;
# - files older than 7 days are deleted daily.
set -eu
KEY="${1:-}"
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
chown root:root "$MNT" && chmod 755 "$MNT"           # a chroot must belong to root, not be group-writable
rm -rf "$MNT/lost+found"

getent group aiex >/dev/null || groupadd aiex
usermod -aG aiex ubuntu
install -d -o root -g aiex -m 2770 "$MNT/files"

if ! id druzhok >/dev/null 2>&1; then
  useradd -m -s /usr/sbin/nologin -G aiex druzhok
  passwd -l druzhok >/dev/null
fi
if [ -n "$KEY" ]; then
  install -d -o druzhok -g druzhok -m 700 /home/druzhok/.ssh
  printf '%s\n' "$KEY" > /home/druzhok/.ssh/authorized_keys
  chown druzhok:druzhok /home/druzhok/.ssh/authorized_keys && chmod 600 /home/druzhok/.ssh/authorized_keys
fi

CONF=/etc/ssh/sshd_config.d/ai-exchange.conf
cat > "$CONF.new" <<'EOC'
Match User druzhok
    ChrootDirectory /srv/ai-exchange
    ForceCommand internal-sftp -u 0007
    PasswordAuthentication no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
EOC
mv "$CONF.new" "$CONF"
if sshd -t; then
  systemctl reload ssh
else
  rm -f "$CONF"; echo "sshd config check failed, nothing changed in sshd" >&2; exit 1
fi

cat > /etc/cron.daily/ai-exchange <<'EOC'
#!/bin/sh
find /srv/ai-exchange/files -mindepth 1 -type f -mtime +7 -delete
find /srv/ai-exchange/files -mindepth 1 -type d -empty -delete
EOC
chmod 755 /etc/cron.daily/ai-exchange

df -h "$MNT" | tail -1
