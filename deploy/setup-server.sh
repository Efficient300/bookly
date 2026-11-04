#!/usr/bin/env bash
# Запускается на сервере (Raspberry Pi): окружение, настройки, служба, маршрут туннеля.
# Использование: setup-server.sh <bookly.example.com>. Можно запускать повторно.
set -euo pipefail

domain=${1:?Укажите адрес Mini App: bookly.example.com}
app=$(cd "$(dirname "$0")/.." && pwd)
port=8787
service=bookly

python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' \
  || { echo "Нужен Python 3.10 или новее, сейчас: $(python3 --version)"; exit 1; }

if ! systemctl is-active --quiet "$service" && ss -ltn | grep ":$port " > /dev/null; then
  echo "Порт $port уже занят другой программой. Поменяйте PORT в server/.env и маршрут туннеля."
  exit 1
fi

cd "$app/server"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv || { echo "Поставьте venv: sudo apt install python3-venv"; exit 1; }
fi
.venv/bin/pip install --quiet --upgrade -r requirements.txt

# Настройки создаём один раз, дальше только обновляем адрес.
set_env() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
[ -f .env ] || cp .env.example .env
chmod 600 .env
set_env WEBAPP_URL "https://$domain"
set_env DEV_MODE 0
set_env HOST 127.0.0.1
if ! grep -q '^BOT_TOKEN=.' .env && [ -t 0 ]; then
  read -rsp 'Токен бота от @BotFather (ввод не отображается): ' token; echo
  read -rp 'Имя бота без @: ' username
  set_env BOT_TOKEN "$token"
  set_env BOT_USERNAME "$username"
fi

sudo tee "/etc/systemd/system/$service.service" > /dev/null <<UNIT
[Unit]
Description=Bookly: Telegram Mini App
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$app/server
ExecStart=$app/server/.venv/bin/python -m app.main
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --quiet "$service"
sudo systemctl restart "$service"

# Маршрут туннеля. Если туннель настроен из панели Cloudflare, файла конфига нет.
config=$(ls /etc/cloudflared/config.yml "$HOME/.cloudflared/config.yml" 2>/dev/null | head -1 || true)
if [ -n "$config" ]; then
  grep '^tunnel:' "$config" || true
  sudo python3 "$app/deploy/add_ingress.py" "$config" "$domain" "http://localhost:$port"
  if ! sudo cloudflared tunnel --config "$config" ingress validate; then
    [ -f "$config.bak" ] && sudo cp "$config.bak" "$config"
    echo "Конфиг не прошёл проверку, вернул прежний."
    exit 1
  fi
  if systemctl cat cloudflared > /dev/null 2>&1; then
    sudo systemctl restart cloudflared
  else
    echo "Служба cloudflared не найдена: перезапустите туннель вручную."
  fi
else
  echo "Файл конфига cloudflared не найден. В панели Cloudflare добавьте к туннелю Public Hostname:"
  echo "  $domain -> http://localhost:$port"
fi

sleep 3
systemctl is-active "$service"
curl -s -o /dev/null -w "API локально: HTTP %{http_code} (401 — норма, нужен вход через Telegram)\n" "http://127.0.0.1:$port/api/me"
grep -q '^BOT_TOKEN=.' .env || echo "BOT_TOKEN пуст: впишите его в $app/server/.env и выполните sudo systemctl restart $service"
sudo journalctl -u "$service" -n 5 --no-pager -o cat
