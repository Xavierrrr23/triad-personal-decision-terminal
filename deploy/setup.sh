#!/usr/bin/env bash
# TRIAD 一键部署脚本 — 阿里云轻量应用服务器 / ECS
# 适用系统镜像:Ubuntu 22.04+ / Debian 12(apt)、Alibaba Cloud Linux 3 / Rocky 9(dnf/yum)
# 前置(重要):轻量服务器控制台「防火墙」放行 TCP 80 与 443;4317 保持不放行。
# 用法(在服务器上):
#   sudo bash deploy/setup.sh triad.example.com your@email.com
# 首次运行会生成 .env.local 并提示你填入 TYPESAFE_API_KEY, 填好后重跑一次即可。
set -euo pipefail

DOMAIN="${1:?用法: sudo bash deploy/setup.sh <域名> [邮箱]}"
EMAIL="${2:-}"
APP_DIR="/opt/triad"
REPO="https://github.com/Xavierrrr23/triad-personal-decision-terminal.git"

# 自动检测包管理器(轻量服务器常见三种系统镜像)
if command -v apt-get >/dev/null 2>&1; then
  PM=apt
elif command -v dnf >/dev/null 2>&1; then
  PM=dnf
elif command -v yum >/dev/null 2>&1; then
  PM=yum
else
  echo "✗ 未找到 apt/dnf/yum。请使用系统镜像:Ubuntu 22.04、Debian 12 或 Alibaba Cloud Linux 3。"
  exit 1
fi
install_pkg() {
  case $PM in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" ;;
    dnf) dnf install -y -q "$@" ;;
    yum) yum install -y -q "$@" ;;
  esac
}

echo "▸ 目标域名: $DOMAIN | 包管理器: $PM"
echo "⚠ 确认:轻量服务器控制台「防火墙」已放行 TCP 80/443,4317 不对外。"

echo "== 1/8 安装依赖 (nginx / git / curl) =="
if [ "$PM" = apt ]; then
  apt-get update -qq
else
  $PM install -y -q epel-release 2>/dev/null || true
fi
install_pkg nginx git curl

echo "== 2/8 安装 Node.js 22 =="
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 22 ]; then
  case $PM in
    apt) curl -fsSL https://deb.nodesource.com/setup_22.x | bash - ;;
    dnf|yum) curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - ;;
  esac
  install_pkg nodejs
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

echo "== 6/8 安装 certbot (Let's Encrypt) =="
install_pkg certbot

echo "== 7/8 启动 PM2 守护 =="
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
pm2 start "$APP_DIR/deploy/ecosystem.config.cjs" 2>/dev/null || pm2 restart triad
pm2 save
# 开机自启(自动适配当前用户,轻量服务器默认 root)
RUN_USER=$(whoami)
pm2 startup systemd -u "$RUN_USER" --hp "$HOME" >/dev/null 2>&1 || true

echo "== 8/8 Nginx 站点 + HTTPS =="
# Debian 系用 sites-enabled;RHEL 系(Alibaba Cloud Linux)没有该目录,直接 conf.d
if [ -d /etc/nginx/sites-available ]; then
  sed "s/triad\\.example\\.com/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/triad
  ln -sf /etc/nginx/sites-available/triad /etc/nginx/sites-enabled/triad
  rm -f /etc/nginx/sites-enabled/default
else
  sed "s/triad\\.example\\.com/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/conf.d/triad.conf
  rm -f /etc/nginx/conf.d/default.conf
fi
mkdir -p /var/www/certbot
nginx -t && systemctl reload nginx && systemctl enable nginx

if [ -n "$EMAIL" ]; then
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --agree-tos -m "$EMAIL" -n
else
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --agree-tos --register-unsafely-without-email -n
fi
systemctl reload nginx

echo ""
echo "✅ 部署完成: https://$DOMAIN"
echo "   证书自动续期已由 certbot 的 systemd 定时器接管 (certbot renew --dry-run 可验证)"
