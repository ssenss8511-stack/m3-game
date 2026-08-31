#!/usr/bin/env bash
# One-shot deploy для VM Ubuntu 22.04+.
# Устанавливает Docker, Nginx, certbot; клонит репо; настраивает reverse-proxy
# на 3000 → 443; выпускает Let's Encrypt сертификат.
#
# Usage (на самой VM):
#   curl -fsSL https://raw.githubusercontent.com/ssenss8511-stack/m3-game/main/deploy.sh | bash -s -- b3match.xyz ssenss8511@gmail.com
set -euo pipefail

DOMAIN="${1:-b3match.xyz}"
EMAIL="${2:-ssenss8511@gmail.com}"
REPO="https://github.com/ssenss8511-stack/m3-game.git"
APP_DIR="$HOME/m3-game"

echo "[deploy] === STAGE 1: system packages ==="
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release git \
                       nginx certbot python3-certbot-nginx

echo "[deploy] === STAGE 2: docker ==="
if ! command -v docker >/dev/null; then
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    UBUNTU_CODENAME=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $UBUNTU_CODENAME stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo usermod -aG docker "$USER"
fi

echo "[deploy] === STAGE 3: clone repo ==="
if [ -d "$APP_DIR/.git" ]; then
    (cd "$APP_DIR" && git pull --ff-only)
else
    git clone "$REPO" "$APP_DIR"
fi

echo "[deploy] === STAGE 4: nginx reverse-proxy ==="
sudo tee /etc/nginx/sites-available/$DOMAIN >/dev/null <<NGX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    # Пропускаем челлендж Let's Encrypt
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGX
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "[deploy] === STAGE 5: HTTPS (Let's Encrypt) ==="
sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN \
     --non-interactive --agree-tos -m "$EMAIL" --redirect || \
     echo "[deploy] certbot failed — DNS ещё не propagated? Запусти позже вручную:"
echo "  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --agree-tos -m $EMAIL --redirect"

echo ""
echo "[deploy] ✅ Готово к запуску контейнера."
echo ""
echo "Осталось два шага (сделай сам):"
echo "  1) cd $APP_DIR/server && nano .env   # вставь секреты (BOT_TOKEN и т.д.)"
echo "  2) cd $APP_DIR && sudo docker compose up -d --build"
echo ""
echo "Проверка:  curl https://$DOMAIN/health"
