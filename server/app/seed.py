"""Демо-данные для локальной разработки: python -m app.seed, затем
открыть http://localhost:5173/?dev_user=1 (1–6 — разные участники).
Повторный запуск пересоздаёт демо-сходки; сходки настоящих пользователей Telegram не трогает.
"""
from datetime import date, timedelta

from .api import DEV_USERS
from .config import Config
from .db import open_db
from .places import load_places
from .plans import PlanService


def main() -> None:
    cfg = Config.from_env()
    db = open_db(cfg.db_path)
    service = PlanService(db, load_places(cfg.places_path), cfg.tz)
    marks = ", ".join("?" * len(DEV_USERS))
    db.execute(f"DELETE FROM plans WHERE owner_id IN ({marks})", list(DEV_USERS))
    for uid, name in DEV_USERS.items():
        service.upsert_user(uid, name)

    today = date.today()
    friday = today + timedelta(days=(4 - today.weekday()) % 7 or 7)
    fri, sat, sun = (str(friday + timedelta(days=n)) for n in range(3))
    times = ["11:00", "13:00", "15:00", "17:00", "19:00", "21:00"]

    def slots(*pairs: tuple[str, str, int]) -> dict:
        return {f"{d}T{t}": v for d, t, v in pairs}

    # 1. Сбор времени на выходные: организатор — Аня.
    weekend = service.create(1, {
        "title": "Встреча на выходных", "format": "eat", "budget": "2", "duration": "2-3",
        "votePlace": True, "middle": True, "days": [fri, sat, sun], "times": times,
        "deadlineHours": 48, "placeId": None,
    })
    answers = [
        (1, "go", slots((fri, "19:00", 1), (fri, "21:00", 1), (sat, "15:00", 1), (sat, "17:00", 1), (sat, "19:00", 1), (sun, "13:00", 1), (sun, "15:00", 2)), (41.33, 69.29)),
        (2, "go", slots((sat, "13:00", 1), (sat, "15:00", 1), (sat, "17:00", 1), (sun, "11:00", 1), (sun, "13:00", 1), (sun, "15:00", 1)), (41.29, 69.22)),
        (3, "go", slots((fri, "19:00", 1), (sat, "17:00", 2), (sat, "19:00", 1), (sat, "21:00", 1), (sun, "15:00", 1)), (41.31, 69.25)),
        (4, "maybe", slots((fri, "19:00", 1), (fri, "21:00", 1), (sat, "19:00", 1), (sun, "15:00", 2)), (41.30, 69.31)),
        (5, "go", slots((fri, "21:00", 1), (sat, "17:00", 1), (sat, "19:00", 1), (sat, "21:00", 1), (sun, "13:00", 1), (sun, "15:00", 1)), (41.34, 69.33)),
    ]
    for uid, status, s, (lat, lng) in answers:
        service.update_me(weekend, uid, {"status": status, "slots": s, "area": {"lat": lat, "lng": lng}})
    service.view(weekend, 6)  # Карина открыла, но ещё не ответила
    for uid, place in [(1, "basil"), (3, "basil"), (4, "basil"), (2, "polka"), (5, "polka"), (5, "lapsha")]:
        service.vote(weekend, uid, place, True)

    # 2. Чужая сходка, где Аня ещё не ответила.
    wed, thu = str(friday + timedelta(days=5)), str(friday + timedelta(days=6))
    games = service.create(2, {
        "title": "Настолки у Тимура", "format": "home", "budget": "any", "duration": "evening",
        "votePlace": False, "middle": False, "days": [wed, thu], "times": ["19:00", "21:00"],
        "deadlineHours": 72, "placeId": None, "place": {"name": "Дома у Тимура", "lat": 41.2925, "lng": 69.2210},
    })
    service.update_me(games, 2, {"status": "go", "slots": slots((wed, "19:00", 1), (thu, "19:00", 1))})
    service.view(games, 1)

    # 3. Подтверждённая встреча через несколько дней.
    bowling_day = str(today + timedelta(days=4))
    bowling = service.create(4, {
        "title": "Боулинг", "format": "active", "budget": "2", "duration": "2-3",
        "votePlace": False, "middle": False, "days": [bowling_day], "times": ["19:00"],
        "deadlineHours": None, "placeId": "strike",
    })
    for uid in (4, 1, 3, 5):
        service.update_me(bowling, uid, {"status": "go", "slots": slots((bowling_day, "19:00", 1))})
    service.confirm(bowling, 4, f"{bowling_day}T19:00", "strike")

    # 4. Прошедшая встреча — для экрана «Как прошло?».
    past_day = str(today - timedelta(days=2))
    past = service.create(1, {
        "title": "Ужин в «Базилике»", "format": "eat", "budget": "2", "duration": "2-3",
        "votePlace": False, "middle": False, "days": [past_day], "times": ["19:00"],
        "deadlineHours": None, "placeId": "basil",
    })
    for uid in (1, 3, 4, 5, 6):
        service.update_me(past, uid, {"status": "go", "slots": slots((past_day, "19:00", 1))})
    service.confirm(past, 1, f"{past_day}T19:00", "basil")

    print("Готово. Откройте Mini App от имени разных участников:")
    for uid, name in DEV_USERS.items():
        print(f"  {name:<7} http://localhost:5173/?dev_user={uid}")
    print(f"Сбор на выходные: http://localhost:5173/?dev_user=1&startapp=p_{weekend}")


if __name__ == "__main__":
    main()
