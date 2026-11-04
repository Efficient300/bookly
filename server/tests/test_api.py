import json
import time
from urllib.parse import urlencode

from starlette.testclient import TestClient

from app.api import create_app
from app.config import Config
from app.db import open_db
from app.init_data import sign_init_data
from app.plans import PlanService

TOKEN = "123456:TEST-token"
PLACES = [{"id": "a", "name": "Кафе А", "kind": "Кафе", "formats": ["eat"], "avgCheck": 80_000, "rating": 4.5, "lat": 41.31, "lng": 69.28}]


def make_client(dev_mode: bool = True) -> TestClient:
    cfg = Config(bot_token=TOKEN, dev_mode=dev_mode, static_dir="нет-такой-папки")
    service = PlanService(open_db(":memory:"), PLACES, cfg.tz)
    return TestClient(create_app(service, cfg))


def tma_header(user_id: int, name: str) -> dict:
    fields = {"user": json.dumps({"id": user_id, "first_name": name}), "auth_date": str(int(time.time()))}
    return {"Authorization": f"tma {urlencode({**fields, 'hash': sign_init_data(fields, TOKEN)})}"}


def test_requires_auth():
    client = make_client()
    response = client.get("/api/plans")
    assert response.status_code == 401
    assert "Telegram" in response.json()["error"]


def test_dev_mode_is_off_by_default():
    client = make_client(dev_mode=False)
    assert client.get("/api/me", headers={"Authorization": "dev 1"}).status_code == 401


def test_telegram_auth_and_plan_flow():
    client = make_client()
    owner = tma_header(1001, "Аня")
    friend = tma_header(1002, "Тимур")

    assert client.get("/api/me", headers=owner).json() == {"id": 1001, "name": "Аня"}

    created = client.post("/api/plans", headers=owner, json={
        "title": "Кофе", "format": "eat", "budget": "any", "duration": "1-2",
        "votePlace": True, "middle": False, "days": ["2030-01-05"], "times": ["12:00", "14:00"],
        "deadlineHours": None, "placeId": None,
    })
    assert created.status_code == 201
    plan_id = created.json()["id"]

    answer = client.patch(f"/api/plans/{plan_id}/me", headers=friend, json={"status": "go", "slots": {"2030-01-05T14:00": 1}})
    assert answer.status_code == 200
    assert answer.json()["isOwner"] is False

    voted = client.post(f"/api/plans/{plan_id}/votes", headers=friend, json={"placeId": "a", "liked": True}).json()
    assert voted["places"][0]["liked"] is True

    forbidden = client.post(f"/api/plans/{plan_id}/confirm", headers=friend, json={"key": "2030-01-05T14:00", "placeId": "a"})
    assert forbidden.status_code == 403

    confirmed = client.post(f"/api/plans/{plan_id}/confirm", headers=owner, json={"key": "2030-01-05T14:00", "placeId": "a"})
    assert confirmed.json()["status"] == "confirmed"

    ics = client.get(f"/api/plans/{plan_id}/event.ics")
    assert ics.headers["content-type"].startswith("text/calendar")
    assert "DTSTART:20300105T140000" in ics.text
    assert "LOCATION:Кафе А" in ics.text

    assert [p["title"] for p in client.get("/api/plans", headers=friend).json()] == ["Кофе"]


def test_bad_json_and_unknown_plan():
    client = make_client()
    headers = {"Authorization": "dev 1", "Content-Type": "application/json"}
    assert client.post("/api/plans", headers=headers, content="{").status_code == 400
    assert client.get("/api/plans/nope", headers=headers).status_code == 404


def test_delete_plan_over_http():
    client = make_client()
    owner, friend = tma_header(1001, "Аня"), tma_header(1002, "Тимур")
    created = client.post("/api/plans", headers=owner, json={
        "title": "Кофе", "format": "eat", "budget": "any", "duration": "1-2", "votePlace": True, "middle": False,
        "days": ["2030-01-05"], "times": ["12:00"], "deadlineHours": None, "placeId": None, "chatId": -100,
    }).json()
    assert created["posted"] is False, "без бота карточку отправить некому"

    url = f"/api/plans/{created['id']}"
    assert client.delete(url, headers=friend).status_code == 403
    assert client.delete(url, headers=owner).json() == {"ok": True}
    assert client.get(url, headers=owner).status_code == 404
