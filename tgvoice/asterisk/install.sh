#!/bin/bash
# Asterisk sozlamalarini WSL ichiga o'rnatadi (har o'zgartirishdan keyin qayta ishga tushiring):
#   wsl -d Cerebro -u root -- bash /mnt/d/Projects/cerebro/tgvoice/asterisk/install.sh
# Egasining SIP paroli Cerebro'ning .env faylidan (SIP_OWNER_PASSWORD) olinadi — bu faylda saqlanmaydi.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/../../.env"
DEST=/etc/asterisk

password="$(grep -E '^SIP_OWNER_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r"'"'" || true)"
if [ -z "$password" ]; then
  echo "SIP_OWNER_PASSWORD .env da yo'q" >&2
  exit 1
fi

for f in pjsip.conf extensions.conf rtp.conf modules.conf; do
  [ -f "$DEST/$f.orig" ] || cp "$DEST/$f" "$DEST/$f.orig"   # Asterisk'ning asl namunasi bir marta saqlanadi
  install -m 644 "$HERE/$f" "$DEST/$f"
done

umask 027
printf '[egasi]\ntype=auth\nauth_type=userpass\nusername=egasi\npassword=%s\n' "$password" > "$DEST/pjsip_egasi.conf"
if [ -f "$HERE/pjsip_shahar.conf" ]; then
  install -m 640 "$HERE/pjsip_shahar.conf" "$DEST/pjsip_shahar.conf"
fi
chown asterisk:asterisk "$DEST"/pjsip_*.conf

systemctl restart asterisk
sleep 2
asterisk -rx 'pjsip show endpoints' | grep -E 'Endpoint:  (egasi|shahar)' || true
echo "Asterisk sozlandi"
