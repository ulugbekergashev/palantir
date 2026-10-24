#!/usr/bin/env bash
# Palantir Hub serverini sozlash — Oracle Linux 9 (RHEL oilasi), x86_64 yoki arm64. scripts/deploy-hub.ts yuklab, root sifatida
# chaqiradi:  setup-server.sh <domen>   (fayllar shu skript yonida: server.ts, admin.ts, legal.ts, package.json; sozlama — /etc/palantir-hub.env)
# Qayta ishga tushirish xavfsiz: bor narsa qayta o'rnatilmaydi, faqat hub fayllari yangilanadi va xizmat qayta yoqiladi.
#   swap 2 GB (bepul server xotirasi 0.5–1 GB) · Node.js 24 (nodejs.org, SHA-256 tekshiriladi) · Caddy (HTTPS, Let's Encrypt avtomatik)
#   · palantir-hub foydalanuvchisi va xizmati (3400-port tashqaridan yopiq — faqat Caddy orqali) · firewalld: http, https
set -euo pipefail

DOMAIN="${1:?domen kerak}"
SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/palantir-hub DATA=/var/lib/palantir-hub NODE=/opt/node
step() { printf '\n== %s\n' "$*"; }

case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 CADDY_ARCH=amd64 ;;
  aarch64) NODE_ARCH=arm64 CADDY_ARCH=arm64 ;;
  *) echo "Noma'lum protsessor: $(uname -m)" >&2; exit 1 ;;
esac

step 'Swap'
# Oracle tasviri 0.5 GB swap beradi — xotira 0.5 GB bo'lgan serverga oz: jami 1 GB dan kam bo'lsa 2 GB qo'shiladi
swap_mb=$(free -m | awk '/^Swap:/ {print $2}')
if [ "${swap_mb:-0}" -lt 1024 ] && [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap defaults 0 0' >> /etc/fstab
  echo "2 GB qo'shildi"
else
  echo bor
fi

step 'Node.js 24'
if ! "$NODE/bin/node" -v 2>/dev/null | grep -q '^v24\.'; then
  base=https://nodejs.org/dist/latest-v24.x
  sums="$(curl -fsSL "$base/SHASUMS256.txt")"
  file="$(awk -v a="linux-$NODE_ARCH.tar.xz" '$2 ~ a"$" {print $2}' <<<"$sums")"
  curl -fsSL "$base/$file" -o "/tmp/$file"
  (cd /tmp && grep " $file\$" <<<"$sums" | sha256sum -c --quiet)
  rm -rf "$NODE" && mkdir -p "$NODE" && tar -xJf "/tmp/$file" -C "$NODE" --strip-components=1 && rm -f "/tmp/$file"
fi
"$NODE/bin/node" -v

step 'Caddy'
# To'liq yo'l bilan: sudo'ning PATH'ida /usr/local/bin yo'q (Oracle Linux)
CADDY=/usr/local/bin/caddy
if [ ! -x "$CADDY" ]; then
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$CADDY_ARCH" -o "$CADDY"
  chmod 755 "$CADDY" && restorecon "$CADDY" 2>/dev/null || true
fi
id caddy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/caddy --create-home --shell /sbin/nologin caddy
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	# Klinikalarning uzun so'rovi (/api/pull) va zaxira yuklash — javob kutib turiladi, hajm cheklanmaydi (hub o'zi cheklaydi)
	reverse_proxy 127.0.0.1:3400 {
		flush_interval -1
	}
}
EOF
cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy (Palantir Hub HTTPS)
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
LimitNOFILE=1048576
Restart=on-failure
TimeoutStopSec=5s

[Install]
WantedBy=multi-user.target
EOF
"$CADDY" version

step 'Hub'
id palantir-hub >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /sbin/nologin palantir-hub
mkdir -p "$APP" "$DATA"
install -m 644 "$SRC"/server.ts "$SRC"/admin.ts "$SRC"/legal.ts "$SRC"/package.json "$APP"/
chown -R palantir-hub:palantir-hub "$DATA" && chmod 750 "$DATA"
test -f /etc/palantir-hub.env || { echo '/etc/palantir-hub.env yo'"'"'q' >&2; exit 1; }
chmod 600 /etc/palantir-hub.env
cat > /etc/systemd/system/palantir-hub.service <<EOF
[Unit]
Description=Palantir Hub
After=network-online.target
Wants=network-online.target

[Service]
User=palantir-hub
Group=palantir-hub
WorkingDirectory=$APP
EnvironmentFile=/etc/palantir-hub.env
ExecStart=$NODE/bin/node --disable-warning=ExperimentalWarning server.ts
Restart=always
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF

step 'Tarmoq devori'
if systemctl is-active --quiet firewalld; then
  firewall-cmd --quiet --permanent --add-service=http --add-service=https && firewall-cmd --quiet --reload
  firewall-cmd --list-services
fi

step 'Xizmatlar'
systemctl daemon-reload
systemctl enable --quiet palantir-hub caddy
systemctl restart palantir-hub
systemctl restart caddy
sleep 2
systemctl --no-pager --lines=0 status palantir-hub caddy | grep -E '^●|Active:'
