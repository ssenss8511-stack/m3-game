# Защита от абуза и фрауда

Кратко о том, что защищает игру и какие шаги ты выполняешь при деплое.

## Уже в коде (не требует твоих действий)

- **Rate limit в Node** — 60 запросов/мин на юзера + 200/мин на IP.
  Файл [server/rate-limit.js](server/rate-limit.js). При превышении API отвечает 429.
- **Sanity-check счёта** — на `/api/end` очки режутся до реалистичного потолка
  (`caps.maxScorePerMove × ходы × 3`), даже если клиент прислал огромное число.
- **`gameId` игровой сессии** — `/api/play` выдаёт токен, `/api/end` его требует.
  Так нельзя засабмитить финал без старта. Плюс проверка минимальной длительности
  партии (>= 3 сек), иначе 429.
- **Отложенный реферал** — 100 монет реферер получает только после того, как
  приглашённый сыграл 5 партий за первые 3 дня. Защита от фейк-аккаунтов.
- **Сервер — источник правды** — energy, coins, chest, tournament, XP.
  Клиент не может подделать через localStorage.

## Что делаешь ты при деплое

### 1. Минификация клиентского кода

Локально перед `git push` (или на сервере до `nginx reload`):

```bash
npm install -g terser
cd "E:/TG GAME"
bash build.sh
```

Создаст `webapp/dist/` с сжатыми JS без комментариев и `console.log`.
Раздавай `dist/` вместо `webapp/js/`.

### 2. Cloudflare Free перед сервером

- Регистрируйся на [dash.cloudflare.com](https://dash.cloudflare.com) (бесплатно)
- Add site → введи свой домен → выбери план **Free**
- Cloudflare даст тебе 2 nameserver (типа `bob.ns.cloudflare.com`)
- Иди в панель регистратора (Namecheap) → Domain → Nameservers → Custom DNS
  → вставь оба CF nameserver → Save
- Дождись переключения (обычно ~5 минут, максимум 24 часа)
- В Cloudflare Dashboard → DNS → добавь A-запись:
  - Name: `@` (root), Value: IP твоей VM, Proxy: **включён (оранжевое облако)**
- SSL/TLS mode: **Full (strict)**
- Firewall → Bot Fight Mode: **включи**

**Что получаешь бесплатно:**
- Скрытие настоящего IP сервера
- DDoS-защита автоматически
- Блок известных ботов
- HTTPS-сертификат от CF (в дополнение к Let's Encrypt)

### 3. Fail2ban на VM (защита SSH от брутфорса)

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban --now
```

По умолчанию: 5 неудачных попыток за 10 минут → блок IP на час.
Проверить статус:
```bash
sudo fail2ban-client status sshd
```

### 4. Автобэкапы БД (ежедневно)

Добавь в crontab (`crontab -e`):
```cron
0 3 * * * cp /var/www/m3/server/data.json /var/www/m3/backups/data-$(date +\%Y-\%m-\%d).json && find /var/www/m3/backups -name 'data-*.json' -mtime +30 -delete
```

Сохраняет копию каждый день в 3:00, удаляет старше 30 дней.
Не забудь создать папку: `mkdir /var/www/m3/backups`.

### 5. Регулярные обновления OS

```bash
sudo apt update && sudo apt upgrade -y   # раз в неделю
```

Или включи `unattended-upgrades` для авто-патчей безопасности:
```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

---

## Что тоже в коде

### 6. Audit log
Все важные события пишутся в **`server/audit.jsonl`** (append-only, батчинг 1 сек):
- `user_created`, `fingerprint` — новый игрок
- `shop_buy`, `booster_buy` — покупки
- `chest_open`, `daily_claim`, `tournament_prize` — награды
- `referral_unlocked` — успешный реферал
- `score_capped` — счёт срезан анти-читом
- `spec_farm_suspect` — подозрение на фарм спец-фишек

Смотреть свежие события: `tail -f server/audit.jsonl`.

### 7. Fingerprint при первом заходе
На `/api/state` собираются: user-agent, IP, TG-язык, TG-имя, is_premium, accept-language.
Хранится в `user.fp`, пишется в audit. Помогает вручную найти multi-account кластеры (много «разных» игроков с одинаковым fingerprint).

### 8. Anti-spec-farming
Если игрок прислал слишком много монет за мало матчей (`coins > matches*5 + 30`) — событие `spec_farm_suspect` в audit. Не блокирует автоматически, только помечает для ручного разбора.

### 9. Автобэкапы data.json
Server сам делает копию `data.json` → `server/backups/data-YYYY-MM-DD.json` **раз в 24 часа**. Старше 30 дней удаляет. Cron не нужен — работает внутри Node-процесса.

## Что добавить позже

- **Server-side TON transaction verification** (когда добавим TON-оплату)
- **Idempotency keys** на TON-платежах
- **SQLite вместо JSON** после ~1000 юзеров
- **Автоматический анализ audit.jsonl** — скрипт находит подозрительные паттерны раз в сутки
