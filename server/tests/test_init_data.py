import json
from urllib.parse import urlencode

import pytest

from app.init_data import InitDataError, sign_init_data, validate_init_data

TOKEN = "123456:TEST-token"
NOW = 1_800_000_000
USER = json.dumps({"id": 42, "first_name": "Аня", "allows_write_to_pm": True}, ensure_ascii=False)


def make_init_data(fields: dict, token: str = TOKEN) -> str:
    return urlencode({**fields, "hash": sign_init_data(fields, token)})


def test_accepts_valid_signature():
    raw = make_init_data({"user": USER, "auth_date": str(NOW - 60), "start_param": "p_abc", "chat_instance": "-77"})
    data = validate_init_data(raw, TOKEN, 3600, NOW)
    assert data.user["id"] == 42
    assert data.user["first_name"] == "Аня"
    assert data.start_param == "p_abc"
    assert data.chat_instance == "-77"


def test_rejects_tampered_data():
    raw = make_init_data({"user": USER, "auth_date": str(NOW - 60)})
    with pytest.raises(InitDataError):
        validate_init_data(raw.replace("42", "43"), TOKEN, 3600, NOW)


def test_rejects_other_token():
    raw = make_init_data({"user": USER, "auth_date": str(NOW - 60)}, "999:other")
    with pytest.raises(InitDataError, match="Неверная подпись"):
        validate_init_data(raw, TOKEN, 3600, NOW)


def test_rejects_expired_data():
    raw = make_init_data({"user": USER, "auth_date": str(NOW - 7200)})
    with pytest.raises(InitDataError, match="устарели"):
        validate_init_data(raw, TOKEN, 3600, NOW)


def test_rejects_missing_hash():
    with pytest.raises(InitDataError, match="Нет подписи"):
        validate_init_data(urlencode({"user": USER, "auth_date": NOW}), TOKEN, 3600, NOW)
