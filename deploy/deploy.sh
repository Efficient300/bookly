#!/usr/bin/env bash
# Запускается на вашем компьютере: собирает Mini App и выкладывает проект на сервер.
# Использование: deploy/deploy.sh <user@host> <bookly.example.com>
# Node на сервере не нужен. server/.env и база на сервере не перезаписываются.
set -euo pipefail

target=${1:?Укажите сервер: user@host}
domain=${2:?Укажите адрес Mini App: bookly.example.com}
cd "$(dirname "$0")/.."

npm run build
git ls-files -co --exclude-standard > .deploy-files
find webapp/dist -type f >> .deploy-files
trap 'rm -f .deploy-files' EXIT

ssh "$target" 'mkdir -p ~/bookly'
grep -v '^\.deploy-files$' .deploy-files | tar -cf - -T - | ssh "$target" 'rm -rf ~/bookly/webapp/dist && tar -xf - -C ~/bookly'
ssh -t "$target" "bash ~/bookly/deploy/setup-server.sh '$domain'"
