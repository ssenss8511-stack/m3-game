# M3 Match-3 backend — контейнер для деплоя на VPS.
# Многослойный, кэш npm install, minimal image.
#
# Сборка:  docker build -t m3-server .
# Запуск:  docker run -d --name m3 -p 3000:3000 --env-file server/.env \
#              -v m3-data:/app/server -v m3-audit:/app/server \
#              --restart unless-stopped m3-server
#
# Volumes:
#   m3-data — data.sqlite / data.json / backups/
#   m3-audit — audit.jsonl
FROM node:20-alpine AS deps
WORKDIR /app/server
COPY server/package*.json ./
# Ставим deps + optional (better-sqlite3 требует build tools для нативной сборки)
RUN apk add --no-cache python3 make g++ \
    && npm install --omit=dev --include=optional \
    && apk del python3 make g++

FROM node:20-alpine
LABEL org.opencontainers.image.title="M3 match-3 server"
LABEL org.opencontainers.image.source="https://github.com/example/m3"

# Non-root пользователь — не запускаем Node от root
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server/  ./server/
COPY webapp/  ./webapp/

# Volumes для персистентных данных
VOLUME ["/app/server/data", "/app/server/backups"]
# Указываем пути через ENV — сервер их читает
ENV DB_PATH=/app/server/data/data.json \
    SQLITE_PATH=/app/server/data/data.sqlite \
    AUDIT_PATH=/app/server/data/audit.jsonl \
    NODE_ENV=production

RUN mkdir -p /app/server/data /app/server/backups && chown -R app:app /app
USER app

EXPOSE 3000
# HEALTHCHECK бьёт по /health и проверяет 200
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/health || exit 1

WORKDIR /app/server
CMD ["node", "server.js"]
