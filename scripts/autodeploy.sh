#!/bin/bash
# Крон-скрипт: раз в 2 мин проверяет git origin/main и пересобирает docker
# если появились новые коммиты. Логи → /var/log/m3-autodeploy.log.
set -u
cd /home/$(logname)/m3-game 2>/dev/null || cd "$HOME/m3-game" 2>/dev/null || {
  echo "$(date -Iseconds) [autodeploy] repo не найден"
  exit 1
}

git fetch -q origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "$(date -Iseconds) [autodeploy] $LOCAL -> $REMOTE, deploying"
git pull --ff-only
if ! sudo docker compose up -d --build 2>&1 | tail -8; then
  echo "$(date -Iseconds) [autodeploy] ❌ docker build failed"
  exit 1
fi

sleep 8
if curl -fsS http://127.0.0.1:3000/health >/dev/null; then
  echo "$(date -Iseconds) [autodeploy] ✅ deployed and healthy"
else
  echo "$(date -Iseconds) [autodeploy] ❌ health check failed"
  exit 1
fi
