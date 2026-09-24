#!/usr/bin/env bash
# TRIAD 一键部署脚本 — 适用于阿里云 Ubuntu 22.04+ / Debian 12
# 用法(在服务器上):
#   sudo bash deploy/setup.sh triad.example.com your@email.com
# 首次运行会生成 .env.local 并提示你填入 TYPESAFE_API_KEY, 填好后重跑一次即可。
set -euo pipefail

DOMAIN="${1:?用法: sudo bash deploy/setup.sh <域名> [邮箱]}"
EMAIL="${2:-}"
APP_DIR="/opt/triad"
REPO="https://github.com/Xavierrrr23/triad-personal-decision-terminal.git"

echo "▸ 目标域名: $DOMAIN"

echo "== 1/8 安装依赖 (nginx / certbot / git / curl) =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot git curl

echo "== 2/8 安装 Node.js 22 =="
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "Node: $(node -v)"

echo "== 3/8 拉取代码 =="
if [ -d "$APP_DIR/.git" ]; then
  (cd "$APP_DIR" && git pull --ff-only)
else
  git clone "$REPO" "$APP_DIR"
fi

echo "== 4/8 生成 .env.local (密钥需你手动填入) =="
if [ ! -f "$APP_DIR/.env.local" ]; then
  cat > "$APP_DIR/.env.local" <<'EOF'
TYPESAFE_API_KEY=PASTE_YOUR_KEY_HERE
PORT=4317
HOST=127.0.0.1
PUBLIC_DAILY_LIMIT=23
TRUST_PROXY=1
EOF
fi
chmod 600 "$APP_DIR/.env.local"

if grep -q 'PASTE_YOUR_KEY_HERE' "$APP_DIR/.env.local"; then
  echo "⚠ 请先编辑 $APP_DIR/.env.local 填入 TYPESAFE_API_KEY, 然后重新运行本脚本。"
  echo "  快速替换: sed -i 's/PASTE_YOUR_KEY_HERE/<你的Key>/' $APP_DIR/.env.local"
  exit 0
fi

echo "== 5/8 运行测试 =="
(cd "$APP_DIR" && npm test)

echo "== 6/8 启动 PM2 守护 =="
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
pm2 start "$APP_DIR/deploy/ecosystem.config.cjs" 2>/dev/null || pm2 restart triad
pm2 save
# 开机自启(以 root 运行时直接生效)
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "== 7/8 Nginx 站点 =="
sed "s/triad\\.example\\.com/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/triad
ln -sf /etc/nginx/sites-available/triad /etc/nginx/sites-enabled/triad
rm -f /etc/nginx/sites-enabled/default
mkdir -p /var/www/certbot
nginx -t && systemctl reload nginx

echo "== 8/8 签发 HTTPS 证书 =="
if [ -n "$EMAIL" ]; then
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --agree-tos -m "$EMAIL" -n
else
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --agree-tos --register-unsafely-without-email -n
fi
systemctl reload nginx

echo ""
echo "✅ 部署完成: https://$DOMAIN"
echo "   证书自动续期已由 certbot 的 systemd 定时器接管 (certbot renew --dry-run 可验证)"
