"""Проверка подписи initData по документации Telegram:
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl


class InitDataError(Exception):
    pass


@dataclass
class InitData:
    user: dict
    auth_date: int
    start_param: str | None
    chat_instance: str | None
    chat_type: str | None


def _data_check_string(fields: dict[str, str]) -> str:
    return "\n".join(f"{key}={fields[key]}" for key in sorted(fields) if key != "hash")


def sign_init_data(fields: dict[str, str], bot_token: str) -> str:
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    return hmac.new(secret, _data_check_string(fields).encode(), hashlib.sha256).hexdigest()


def validate_init_data(raw: str, bot_token: str, max_age_sec: int, now: float | None = None) -> InitData:
    if not bot_token:
        raise InitDataError("BOT_TOKEN не задан")
    fields = dict(parse_qsl(raw, keep_blank_values=True))
    given = fields.get("hash")
    if not given:
        raise InitDataError("Нет подписи")
    if not hmac.compare_digest(sign_init_data(fields, bot_token), given):
        raise InitDataError("Неверная подпись")

    auth_date = int(fields.get("auth_date") or 0)
    now = time.time() if now is None else now
    if not auth_date or now - auth_date > max_age_sec:
        raise InitDataError("Данные устарели")

    user = json.loads(fields.get("user") or "null")
    if not isinstance(user, dict) or not user.get("id"):
        raise InitDataError("Нет пользователя")

    return InitData(
        user=user,
        auth_date=auth_date,
        start_param=fields.get("start_param"),
        chat_instance=fields.get("chat_instance"),
        chat_type=fields.get("chat_type"),
    )
