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
# Administrator telefoni: parolni panel yozadi; hali yaratilmagan bo'lsa — hech kim bilmaydigan tasodifiy parol (ulanib bo'lmaydi)
if [ -f "$HERE/pjsip_admin.conf" ]; then
  install -m 640 "$HERE/pjsip_admin.conf" "$DEST/pjsip_admin.conf"
elif [ ! -f "$DEST/pjsip_admin.conf" ]; then
  printf '[admin]\ntype=auth\nauth_type=userpass\nusername=admin\npassword=%s\n' "$(head -c 24 /dev/urandom | base64 | tr -d '/+=')" > "$DEST/pjsip_admin.conf"
fi
# Kim javob beradi — Asterisk Cerebro'dan so'raydi (extensions.conf, [kiruvchi]): manzil va ovozli agent kaliti
key="$(grep -E '^VOICE_AGENT_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r"'"'" || true)"
port="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r"'"'" || true)"
printf '[globals]\nCEREBRO_URL=http://127.0.0.1:%s\nCEREBRO_KEY=%s\n' "${port:-3200}" "$key" > "$DEST/extensions_cerebro.conf"
chown asterisk:asterisk "$DEST"/pjsip_*.conf "$DEST/extensions_cerebro.conf"

# «reload» — qo'ng'iroqlarni uzmasdan qayta yuklash (panel shunday chaqiradi); argumentsiz — to'liq qayta ishga tushirish
if [ "${1:-}" = "reload" ] && systemctl is-active --quiet asterisk; then
  asterisk -rx 'module reload res_pjsip.so' >/dev/null
  asterisk -rx 'dialplan reload' >/dev/null
else
  systemctl restart asterisk
  sleep 2
fi
asterisk -rx 'pjsip show endpoints' | grep -E 'Endpoint:  (egasi|admin|shahar)' || true
echo "Asterisk sozlandi"
