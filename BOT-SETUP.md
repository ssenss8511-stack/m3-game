# Как открыть игру в Telegram через бота

Пошаговая инструкция от создания бота до работающего Mini App.

---

## Шаг 1. Создать бота в Telegram

1. Открой в Telegram **@BotFather**.
2. Отправь `/newbot`.
3. Придумай имя (что показывается в чате, например `M3 Game`).
4. Придумай username — должен заканчиваться на `bot`, например `m2_match3_bot`.
5. BotFather пришлёт **токен** вида `123456789:AAH...` — это твой `BOT_TOKEN`.
   ⚠️ Никому не показывай, никуда не коммить.

---

## Шаг 2. Завести сервер с публичным HTTPS

Telegram **требует HTTPS** для Mini App — `localhost` или `http://` не подойдут.

### Самый простой путь — VPS + домен + Let's Encrypt

1. Купи VPS (Hetzner / Reg.ru / Timeweb / любой — от ~3-5$/мес хватит).
2. Купи или возьми бесплатный домен.
3. Направь A-запись домена на IP сервера.
4. Поставь Node.js 18+, Nginx и certbot:
   ```bash
   sudo apt update && sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx
   ```
5. Скопируй проект на сервер (например в `/var/www/m2`).
6. Поставь зависимости и запусти:
   ```bash
   cd /var/www/m2/server
   npm install
   cp .env.example .env
   nano .env    # заполни BOT_TOKEN и WEBAPP_URL (см. ниже)
   ```
7. Настрой Nginx как реверс-прокси (`/etc/nginx/sites-available/m2`):
   ```nginx
   server {
     server_name твой.домен;
     location / {
       proxy_pass http://localhost:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
     }
   }
   ```
8. Активируй сайт и получи HTTPS:
   ```bash
   sudo ln -s /etc/nginx/sites-available/m2 /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d твой.домен
   ```
9. Запусти сервер под pm2:
   ```bash
   sudo npm i -g pm2
   pm2 start server.js --name m2 --cwd /var/www/m2/server
   pm2 save && pm2 startup    # автозапуск при перезагрузке
   ```

### Альтернатива на 5 минут (для теста, не для продакшна)

**Cloudflare Tunnel** или **ngrok** дадут публичный HTTPS поверх твоего
localhost. Подходит, чтобы быстро показать бот другу:

```bash
# ngrok
ngrok http 3000
# скопируй HTTPS-адрес — это твой WEBAPP_URL
```

---

## Шаг 3. Заполнить `.env` сервера

```env
BOT_TOKEN=123456789:AAH...          # от BotFather
WEBAPP_URL=https://твой.домен       # ВАЖНО: https://
PORT=3000
```

Перезапусти сервер: `pm2 restart m2`. В логах должна появиться строка
`[bot] Запущен. WebApp URL: https://твой.домен`.

---

## Шаг 4. Привязать Mini App к боту в @BotFather

Так Telegram научится открывать игру не только по кнопке, но и из меню чата.

1. В @BotFather: `/mybots` → выбери своего бота.
2. **Bot Settings → Menu Button → Configure menu button**.
3. URL: `https://твой.домен` (тот же, что в `WEBAPP_URL`).
4. Текст кнопки: например `Играть`.

Дополнительно (необязательно):
- `/setdescription` — описание бота в карточке.
- `/setuserpic` — аватарка.
- `/setcommands` — список команд:
  ```
  start - Открыть игру
  play - Открыть игру
  help - Помощь
  ```

---

## Шаг 5. Проверить

1. Открой своего бота в Telegram.
2. Жми `/start` — придёт сообщение с кнопкой **🎮 Играть в M3**.
3. Нажми кнопку — игра откроется как Mini App внутри Telegram.

Готово 🎉

---

## Рефералы

После создания бота открой `webapp/js/config.js` и замени:

```js
botUsername: 'your_bot_username',
```

на свой username бота **без `@`** (например `m2_match3_bot`). Тогда кнопка
«Пригласить» будет генерировать ссылки вида:
`https://t.me/m2_match3_bot?start=ref_<user_id>`.

Когда новый игрок переходит по такой ссылке и жмёт `/start`, бот замечает
параметр `ref_X` и начисляет **+100 монет** обоим (один раз в жизни).

## Пуши о восстановлении энергии и ежедневке

Они работают автоматически: при `/start` бот запоминает `chat_id` игрока,
сервис [notifier.js](server/notifier.js) каждые 5 минут просматривает
игроков и отправляет:
- ⚡ «Попытки восстановились» — если энергия полна и игрок 3+ часа не
  заходил (не чаще раза в 18 часов).
- 🎁 «Доступна ежедневная награда» — если её можно забрать (не чаще раза
  в 20 часов).

Если игрок заблокирует бота, мы автоматически перестаём ему слать (по
коду 403 от Telegram).

## Как это работает внутри

- **Long polling**: бот сам опрашивает Telegram через `getUpdates`. Простой
  способ, не нужны webhook'и и https для бота. Минус — постоянное
  соединение к Telegram. Подходит для проектов на одном VPS.
- **Webhook** (на потом): Telegram сам шлёт POST на твой `/bot-webhook`.
  Дешевле по ресурсам, нужен HTTPS (он у нас уже есть). Если будет рост
  нагрузки — переключим, поменяв 5 строк в `bot.js`.

## Если бот не отвечает

- Проверь логи: `pm2 logs m2`.
- В логах `polling_error: ETELEGRAM 401` → токен неверный.
- В логах ничего про бота → не заданы `BOT_TOKEN` или `WEBAPP_URL`.
- Кнопка приходит, но игра не открывается → проверь, что `WEBAPP_URL`
  открывается в обычном браузере по HTTPS и показывает страницу M3.
- В @BotFather → My Bots → твой бот → Bot Settings → **Domain**: должен
  быть твой домен (для Mini App).
