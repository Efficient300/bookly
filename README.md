# Сходка — Telegram Mini App

Договориться о встрече: когда всем удобно и куда пойти.

- `server/` — Python: HTTP API (Starlette + uvicorn), бот (python-telegram-bot), SQLite.
- `webapp/` — сама Mini App (React + Vite). Telegram открывает её как веб-страницу, поэтому она на JS.
- `shared/` — форма данных API и подписи на русском для Mini App.

Все Python-зависимости на чистом Python, поэтому ставятся на любую версию, включая 3.15.

> На Windows держите проект в коротком пути, например `C:\dev\skhodka`. В очень глубоких папках
> упираетесь в лимит Windows на длину пути (260 символов), и `pip`/`venv` падают с «файл не найден».

## Запуск без Telegram (разработка)

Сервер:

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env
python -m app.seed
python -m app.main
```

В `.env.example` уже стоит `DEV_MODE=1` — вход без Telegram. `app.seed` создаёт демо-сходки.

Mini App, в другом терминале из корня проекта:

```bash
npm install
npm run dev
```

Откройте `http://localhost:5173/?dev_user=1` — это Аня. Числа 1–6 — разные участники, так удобно смотреть одну сходку глазами нескольких людей.

Тесты и проверка типов:

```bash
cd server && pytest
npm run typecheck
```

## Подключение к Telegram

1. В [@BotFather](https://t.me/BotFather) отправьте `/newbot` — получите токен и имя бота.
2. Соберите Mini App: `npm run build`. Сервер сам раздаёт `webapp/dist`, поэтому API и Mini App живут на одном адресе.
3. Telegram открывает Mini App только по HTTPS. Поднимите туннель на сервер
   ([cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/),
   на Windows: `winget install --id Cloudflare.cloudflared`):
   ```bash
   cloudflared tunnel --url http://localhost:8787
   ```
   Он напишет адрес вида `https://….trycloudflare.com`.
4. `server/.env`: `BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL` и `DEV_MODE=0` —
   туннель открывает сервер всему интернету, а с `DEV_MODE=1` войти можно за любого.
5. Запустите сервер. Он сам поставит в чате с ботом кнопку «Открыть» с адресом из `WEBAPP_URL`.
6. Включите главное Mini App, чтобы бот выглядел как приложение: кнопка открытия в профиле и раздел приложений в поиске.
   В BotFather: `/mybots` → ваш бот → Bot Settings → Configure Mini App → Enable Mini App, затем отправьте тот же адрес.
   На это Mini App ведут ссылки из карточек (`t.me/<бот>?startapp=…`).
7. Чтобы отправлять карточку сходки в чаты, включите в BotFather ещё две настройки:
   - `/setinline` — через inline-режим Mini App вставляет карточку в выбранный чат;
   - `/setinlinefeedback` — без этого бот не сможет обновлять карточку после ответов.

Адрес `trycloudflare.com` меняется при каждом запуске туннеля. Тогда обновите `WEBAPP_URL`, перезапустите сервер
и смените адрес в Configure Mini App. Для постоянной работы нужен постоянный адрес (см. «Продакшен»).

Отдельное приложение через `/newapp` не обязательно. Если оно нужно, впишите его короткое имя в `APP_SHORT_NAME`,
и ссылки станут вида `t.me/<бот>/<имя>?startapp=…`.

Для разработки с мгновенным обновлением страницы туннель можно вести на Vite (`http://localhost:5173`):
он сам проксирует `/api` на сервер.

`webapp/.env` (пример — `webapp/.env.example`) необязателен: `VITE_BOT_USERNAME` нужен только для ссылки,
которую Mini App копирует, когда открыта вне Telegram. После изменения пересоберите: `npm run build`.

Как это работает в чате:

- `/plan` в группе — кнопка «Создать сходку».
- После создания Mini App сама предлагает выбрать чат и вставляет карточку.
- Карточка обновляется по мере ответов, а после подтверждения бот пишет участникам в личку и напоминает за сутки и за 2 часа.
- Писать в личку бот может только тем, кто разрешил это в Mini App (`requestWriteAccess`).

## Продакшен

1. `npm run build` — сборка попадёт в `webapp/dist`, и Python-сервер сам её раздаёт.
2. Один процесс `python -m app.main` за HTTPS (Caddy или nginx). API и Mini App на одном адресе.
3. Карты — Яндекс (JS API 2.1). Получите ключ «JavaScript API и HTTP Геокодер» в [кабинете разработчика](https://developer.tech.yandex.ru), впишите в `webapp/.env` как `VITE_YANDEX_MAPS_KEY` и пересоберите. Без ключа карта открывается, но это режим для разработки.
4. Каталог мест — `server/data/places.json`: средний чек в сумах (`avgCheck`) и координаты. Сейчас там вымышленные места в Ташкенте для примера, замените на настоящие.
5. База — файл `server/data/skhodka.db`, делайте его резервные копии.

## Развёртывание на Raspberry Pi

Нужны Python 3.10+ на Pi, вход по SSH-ключу и туннель Cloudflare. Из корня проекта в Git Bash:

```bash
bash deploy/deploy.sh user@host bookly.example.com
```

Скрипт соберёт Mini App, скопирует проект в `~/bookly`, создаст службу `bookly` и добавит маршрут в конфиг
cloudflared. Node на Pi не нужен, `server/.env` и база при обновлении не перезаписываются.
При первом запуске из терминала он спросит токен бота; иначе впишите `BOT_TOKEN` и `BOT_USERNAME`
в `~/bookly/server/.env` и выполните `sudo systemctl restart bookly`.

Если туннель настроен из панели Cloudflare, файла конфига на Pi нет: добавьте Public Hostname на `http://localhost:8787`.

## Что дальше

- Импорт занятости из Google Календаря (OAuth во внешнем браузере).
- Pro-подписка за Telegram Stars.
- Кабинет заведений и бронирование.
- ИИ-подбор плана.
