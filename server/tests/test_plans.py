from datetime import datetime, timedelta

import pytest

from app.db import open_db
from app.plans import HttpError, PlanService, rank_slots

PLACES = [
    {"id": "a", "name": "Кафе А", "kind": "Кафе", "formats": ["eat"], "avgCheck": 80_000, "rating": 4.5, "lat": 41.31, "lng": 69.28},
    {"id": "b", "name": "Бар Б", "kind": "Бар", "formats": ["bar"], "avgCheck": 200_000, "rating": 4.2, "lat": 41.32, "lng": 69.29},
    {"id": "c", "name": "Ресторан В", "kind": "Ресторан", "formats": ["eat"], "avgCheck": 400_000, "rating": 4.9, "lat": 41.30, "lng": 69.27},
]

BASE_PLAN = {
    "title": "Тест",
    "format": "eat",
    "budget": "2",
    "duration": "2-3",
    "votePlace": True,
    "middle": True,
    "days": ["2030-01-04", "2030-01-05"],
    "times": ["18:00", "20:00"],
    "deadlineHours": 24,
    "placeId": None,
}


@pytest.fixture
def service() -> PlanService:
    s = PlanService(open_db(":memory:"), PLACES, "Asia/Tashkent")
    for uid, name in [(1, "Аня"), (2, "Тимур"), (3, "Лена")]:
        s.upsert_user(uid, name)
    return s


def test_rank_slots_prefers_more_free_people():
    top = rank_slots(["d1T18:00", "d1T20:00", "d2T18:00"], [
        {"name": "А", "status": "go", "slots": {"d1T20:00": 1, "d2T18:00": 2}},
        {"name": "Б", "status": "go", "slots": {"d1T20:00": 2, "d2T18:00": 1}},
        {"name": "В", "status": "go", "slots": {"d1T20:00": 1}},
        {"name": "Г", "status": "no", "slots": {"d1T18:00": 1}},
    ])
    assert [s["key"] for s in top] == ["d1T20:00", "d2T18:00"]
    assert top[0]["good"] == 2
    assert top[0]["maybeNames"] == ["Б"]
    assert top[1]["missing"] == ["В", "Г"]


def test_full_cycle(service: PlanService):
    plan_id = service.create(1, BASE_PLAN)
    service.update_me(plan_id, 1, {"status": "go", "slots": {"2030-01-05T20:00": 1}, "area": {"lat": 41.311234, "lng": 69.278765}})
    service.update_me(plan_id, 2, {"status": "go", "slots": {"2030-01-05T20:00": 2, "неверный-ключ": 1}})
    service.update_me(plan_id, 3, {"status": "no"})
    service.vote(plan_id, 2, "a", True)

    view = service.view(plan_id, 1)
    assert view["responded"] == 3
    assert view["heat"]["2030-01-05T20:00"] == 2
    assert view["top"][0]["key"] == "2030-01-05T20:00"
    assert view["me"]["area"] == {"lat": 41.31, "lng": 69.28}, "район округляется"
    assert view["me"]["slots"] == {"2030-01-05T20:00": 1}
    # Бюджет «до 250 тыс» убирает ресторан со средним чеком 400 тыс, формат «Поесть» — бар.
    assert [p["id"] for p in view["places"]] == ["a"]
    assert view["places"][0]["votes"] == 1

    with pytest.raises(HttpError) as err:
        service.confirm(plan_id, 2, "2030-01-05T20:00", "a")
    assert err.value.status == 403

    confirmed = service.confirm(plan_id, 1, "2030-01-05T20:00", "a")
    assert confirmed["status"] == "confirmed"
    assert confirmed["chosen"] == {"date": "2030-01-05", "time": "20:00", "placeId": "a"}

    card = service.card(plan_id)
    assert card["placeName"] == "Кафе А"
    assert card["going"] == ["Аня", "Тимур"]


def test_past_plan_is_done_and_bill_splits(service: PlanService):
    plan_id = service.create(1, {**BASE_PLAN, "days": ["2020-01-04"], "times": ["18:00"], "votePlace": False, "placeId": "a"})
    service.confirm(plan_id, 1, "2020-01-04T18:00", None)
    view = service.set_bill(plan_id, 1, 90)
    assert view["status"] == "done"
    assert view["bill"] == {"total": 90, "payerId": 1, "paid": []}

    with pytest.raises(HttpError) as err:
        service.mark_paid(plan_id, 3, 2, True)
    assert err.value.status == 403
    assert service.mark_paid(plan_id, 2, 2, True)["bill"]["paid"] == [2]


def test_reminders_once_per_stage(service: PlanService):
    start = (datetime.now(service.tz) + timedelta(hours=20)).replace(minute=0, second=0, microsecond=0)
    day, time = start.strftime("%Y-%m-%d"), start.strftime("%H:00")
    plan_id = service.create(1, {**BASE_PLAN, "days": [day], "times": [time]})
    service.confirm(plan_id, 1, f"{day}T{time}", None)

    now = datetime.now(service.tz)
    assert service.due_reminders(now) == [{"planId": plan_id, "kind": "day"}]
    assert service.due_reminders(now) == []
    assert service.due_reminders(start - timedelta(hours=1)) == [{"planId": plan_id, "kind": "soon"}]


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"title": ""}, "Название"),
        ({"days": []}, "дней"),
        ({"times": ["25:00"]}, "время"),
        ({"votePlace": False, "placeId": "нет"}, "Место"),
        ({"votePlace": False, "middle": False}, "место встречи"),
        ({"votePlace": False, "middle": False, "place": {"name": ""}}, "Название места"),
        ({"votePlace": False, "middle": False, "place": {"name": "Кафе", "lat": 91, "lng": 69}}, "точка"),
        ({"votePlace": False, "middle": False, "place": {"name": "Кафе", "url": "javascript:alert(1)"}}, "http"),
    ],
)
def test_create_validation(service: PlanService, patch: dict, message: str):
    with pytest.raises(HttpError, match=message):
        service.create(1, {**BASE_PLAN, **patch})


def test_organizer_names_meeting_point(service: PlanService):
    plan_id = service.create(1, {
        **BASE_PLAN, "votePlace": False, "middle": False,
        "place": {"name": "Чайхана у парка", "url": "https://yandex.uz/maps/-/abc", "lat": 41.3, "lng": 69.25},
    })
    service.update_me(plan_id, 2, {"status": "go", "area": {"lat": 41.31, "lng": 69.28}})

    view = service.view(plan_id, 1)
    first = view["places"][0]
    assert view["placeId"] == first["id"]
    assert (first["name"], first["kind"], first["lat"], first["lng"]) == ("Чайхана у парка", "Место встречи", 41.3, 69.25)
    assert first["avgCheck"] is None
    assert first["travel"] == "≈ 15 мин от вас"

    confirmed = service.confirm(plan_id, 1, "2030-01-05T20:00", None)
    assert confirmed["chosen"]["placeId"] == first["id"]
    assert service.card(plan_id)["placeName"] == "Чайхана у парка"


def test_suggested_place_keeps_point(service: PlanService):
    plan_id = service.create(1, BASE_PLAN)
    view = service.suggest_place(plan_id, 2, {"name": "Кафе у дома", "url": None, "lat": 41.2995, "lng": 69.2401})
    mine = next(p for p in view["places"] if p["custom"])
    assert (mine["lat"], mine["lng"], mine["kind"], mine["votes"]) == (41.2995, 69.2401, "Предложили участники", 1)

    without_point = service.suggest_place(plan_id, 3, {"name": "Где-нибудь"})
    assert next(p for p in without_point["places"] if p["name"] == "Где-нибудь")["lat"] is None


def test_old_database_gets_point_columns(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE custom_places (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, name TEXT NOT NULL,
                                    url TEXT, added_by INTEGER NOT NULL);
        INSERT INTO custom_places VALUES ('c_1', 'p', 'Старое место', NULL, 1);
    """)
    old.close()

    db = open_db(str(path))
    row = db.execute("SELECT name, lat, lng FROM custom_places").fetchone()
    assert (row["name"], row["lat"], row["lng"]) == ("Старое место", None, None)
