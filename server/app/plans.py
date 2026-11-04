"""Логика сходок. Ответы — словари с ключами в camelCase, как в shared/types.ts у Mini App."""
import json
import re
import secrets
import sqlite3
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any, NoReturn, Protocol
from zoneinfo import ZoneInfo

from .formatting import BUDGET_LABELS, DURATION_HOURS, FORMAT_LABELS, days_range_label
from .places import center_of, distance_km, filter_places, round_area, travel_range


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class Notifier(Protocol):
    def plan_changed(self, plan_id: str) -> None: ...
    def plan_confirmed(self, plan_id: str) -> None: ...
    def nudge(self, plan_id: str, user_ids: list[int]) -> None: ...
    def remind(self, plan_id: str, kind: str) -> None: ...
    def plan_deleted(self, card: dict, user_ids: list[int]) -> None: ...
    async def post_card(self, plan_id: str, chat_id: int, user_id: int) -> bool: ...


class NoopNotifier:
    def plan_changed(self, plan_id: str) -> None: pass
    def plan_confirmed(self, plan_id: str) -> None: pass
    def nudge(self, plan_id: str, user_ids: list[int]) -> None: pass
    def remind(self, plan_id: str, kind: str) -> None: pass
    def plan_deleted(self, card: dict, user_ids: list[int]) -> None: pass
    async def post_card(self, plan_id: str, chat_id: int, user_id: int) -> bool: return False


STATUSES = {"go", "maybe", "no"}
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def new_id(nbytes: int = 6) -> str:
    return secrets.token_urlsafe(nbytes)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def fail(message: str) -> NoReturn:
    raise HttpError(400, message)


def clean_place(data: Any) -> dict:
    """Своё место: название, ссылка и точка на карте (ссылка и точка необязательны)."""
    if not isinstance(data, dict):
        fail("Укажите место")
    name = str(data.get("name") or "").strip()
    if not name or len(name) > 60:
        fail("Название места — до 60 символов")
    url = str(data.get("url") or "").strip() or None
    if url and not re.match(r"^https?://", url, re.IGNORECASE):
        fail("Ссылка должна начинаться с http")
    lat, lng = data.get("lat"), data.get("lng")
    if lat is None and lng is None:
        return {"name": name, "url": url, "lat": None, "lng": None}
    numbers = all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lat, lng))
    if not numbers or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        fail("Неверная точка на карте")
    return {"name": name, "url": url, "lat": round(lat, 6), "lng": round(lng, 6)}


def slot_keys(days: list[str], times: list[str]) -> list[str]:
    return [f"{d}T{t}" for d in days for t in times]


def rank_slots(keys: list[str], responses: list[dict]) -> list[dict]:
    """Лучшие слоты: больше всего свободных, при равенстве — больше «удобно», потом раньше.

    responses: [{"name", "status", "slots"}], slots — {ключ: 1 (удобно) | 2 (если надо)}.
    """
    stats = []
    for key in keys:
        date, time = key.split("T")
        good, maybe, missing = [], [], []
        for r in responses:
            value = None if r["status"] == "no" else r["slots"].get(key)
            (good if value == 1 else maybe if value == 2 else missing).append(r["name"])
        if good or maybe:
            stats.append({
                "key": key, "date": date, "time": time,
                "good": len(good), "maybe": len(maybe),
                "missing": missing, "maybeNames": maybe,
            })
    return sorted(stats, key=lambda s: (-(s["good"] + s["maybe"]), -s["good"], s["key"]))


class PlanService:
    def __init__(self, db: sqlite3.Connection, places: list[dict], tz: str = "UTC"):
        self.db = db
        self.places = places
        self.tz = ZoneInfo(tz)
        self.notifier: Notifier = NoopNotifier()

    # ---------- пользователи ----------

    def upsert_user(self, user_id: int, name: str, username: str | None = None, allows_pm: bool | None = None) -> None:
        allows = None if allows_pm is None else int(allows_pm)
        self.db.execute(
            """INSERT INTO users (id, name, username, allows_pm, updated_at)
               VALUES (?, ?, ?, COALESCE(?, 0), ?)
               ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 username = excluded.username,
                 allows_pm = COALESCE(?, users.allows_pm),
                 updated_at = excluded.updated_at""",
            (user_id, name, username, allows, now_iso(), allows),
        )

    def set_allows_pm(self, user_id: int, allowed: bool) -> None:
        self.db.execute("UPDATE users SET allows_pm = ? WHERE id = ?", (int(allowed), user_id))

    def user_name(self, user_id: int) -> str:
        row = self.db.execute("SELECT name FROM users WHERE id = ?", (user_id,)).fetchone()
        return row["name"] if row else "Гость"

    # ---------- создание и чтение ----------

    def create(self, owner_id: int, data: dict) -> str:
        title = str(data.get("title") or "").strip()
        if not title or len(title) > 80:
            fail("Название — от 1 до 80 символов")
        if data.get("format") not in FORMAT_LABELS:
            fail("Неизвестный формат")
        if data.get("budget") not in BUDGET_LABELS:
            fail("Неизвестный бюджет")
        if data.get("duration") not in DURATION_HOURS:
            fail("Неизвестная длительность")
        days = sorted(set(data.get("days") or []))
        times = sorted(set(data.get("times") or []))
        if not 1 <= len(days) <= 14 or not all(isinstance(d, str) and DAY_RE.match(d) for d in days):
            fail("Выберите от 1 до 14 дней")
        if not 1 <= len(times) <= 12 or not all(isinstance(t, str) and TIME_RE.match(t) for t in times):
            fail("Выберите время")
        place_id = None if data.get("votePlace") else data.get("placeId")
        if place_id and not self._catalog_place(place_id):
            fail("Место не найдено")
        # Без голосования и без поиска середины организатор сразу называет место встречи.
        own_place = None
        if not data.get("votePlace") and not place_id and data.get("place") is not None:
            own_place = clean_place(data["place"])
        if not data.get("votePlace") and not data.get("middle") and not place_id and not own_place:
            fail("Укажите место встречи")
        hours = data.get("deadlineHours")
        if hours is not None and not (isinstance(hours, (int, float)) and 0 < hours <= 24 * 14):
            fail("Неверный срок ответа")
        deadline = None
        if hours:
            deadline = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(timespec="milliseconds").replace("+00:00", "Z")

        plan_id = new_id()
        self.db.execute(
            """INSERT INTO plans (id, owner_id, title, format, budget, duration, vote_place, middle,
                                  days, times, deadline, place_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (plan_id, owner_id, title, data["format"], data["budget"], data["duration"],
             int(bool(data.get("votePlace"))), int(bool(data.get("middle"))),
             json.dumps(days), json.dumps(times), deadline, place_id, now_iso()),
        )
        self._ensure_member(plan_id, owner_id)
        if own_place:
            place_id = self._add_custom_place(plan_id, owner_id, own_place)
            self.db.execute("UPDATE plans SET place_id = ? WHERE id = ?", (place_id, plan_id))
        return plan_id

    def view(self, plan_id: str, user_id: int) -> dict:
        row = self._plan_row(plan_id)
        self._ensure_member(plan_id, user_id)
        return self._build(row, user_id)

    def delete(self, plan_id: str, user_id: int) -> None:
        row = self._plan_row(plan_id)
        if row["owner_id"] != user_id:
            raise HttpError(403, "Удалить может только организатор")
        card = self.card(plan_id)
        ids = self.recipients(plan_id, lambda m: not m["isOwner"] and m["status"] in ("go", "maybe"))
        self.db.execute("DELETE FROM votes WHERE plan_id = ?", (plan_id,))
        self.db.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
        self.notifier.plan_deleted(card, ids)

    def list_for_chat(self, chat_id: int) -> list[dict]:
        """Актуальные сходки группы, новые сверху."""
        rows = self.db.execute("SELECT * FROM plans WHERE chat_id = ? ORDER BY created_at DESC", (chat_id,)).fetchall()
        return [
            {"id": r["id"], "title": r["title"], "status": self._status_of(r)}
            for r in rows
            if self._status_of(r) != "done" and not self._expired(r)
        ]

    def list_for_user(self, user_id: int) -> list[dict]:
        rows = self.db.execute(
            """SELECT p.*, m.status AS my_status FROM plans p
               JOIN members m ON m.plan_id = p.id AND m.user_id = ?
               ORDER BY p.created_at DESC LIMIT 50""",
            (user_id,),
        ).fetchall()
        result = []
        for row in rows:
            members = self._member_rows(row["id"])
            status = self._status_of(row)
            result.append({
                "id": row["id"],
                "title": row["title"],
                "status": status,
                "isOwner": row["owner_id"] == user_id,
                "expired": self._expired(row),
                "needsAnswer": (
                    status == "collecting" and row["my_status"] is None
                    and row["owner_id"] != user_id and not self._expired(row)
                ),
                "deadline": row["deadline"],
                "chosen": {"date": row["chosen_date"], "time": row["chosen_time"]} if row["chosen_date"] else None,
                "placeName": self._place_name(row),
                "going": [m["name"] for m in members if m["status"] == "go"],
                "responded": sum(1 for m in members if m["status"] is not None),
            })
        return result

    # ---------- ответы участников ----------

    def update_me(self, plan_id: str, user_id: int, patch: dict) -> dict:
        row = self._plan_row(plan_id)
        self._ensure_member(plan_id, user_id)
        sets: list[str] = []
        values: list[Any] = []

        if "status" in patch:
            if patch["status"] not in STATUSES:
                fail("Неизвестный статус")
            sets.append("status = ?")
            values.append(patch["status"])
        if "slots" in patch:
            if row["status"] != "collecting":
                fail("Время уже выбрано")
            allowed = set(slot_keys(json.loads(row["days"]), json.loads(row["times"])))
            raw = patch["slots"] if isinstance(patch["slots"], dict) else {}
            clean = {k: v for k, v in raw.items() if k in allowed and v in (1, 2)}
            sets.append("slots = ?")
            values.append(json.dumps(clean))
        if "area" in patch:
            area = patch["area"]
            if area is not None:
                try:
                    area = round_area({"lat": float(area["lat"]), "lng": float(area["lng"])})
                except (TypeError, KeyError, ValueError):
                    fail("Неверные координаты")
                if abs(area["lat"]) > 90 or abs(area["lng"]) > 180:
                    fail("Неверные координаты")
            sets += ["area_lat = ?", "area_lng = ?"]
            values += [area["lat"] if area else None, area["lng"] if area else None]
        if "remind" in patch:
            sets.append("remind = ?")
            values.append(int(bool(patch["remind"])))

        if sets:
            self.db.execute(
                f"UPDATE members SET {', '.join(sets)} WHERE plan_id = ? AND user_id = ?",
                (*values, plan_id, user_id),
            )
        if "status" in patch or "slots" in patch:
            self.notifier.plan_changed(plan_id)
        return self._build(self._plan_row(plan_id), user_id)

    def vote(self, plan_id: str, user_id: int, place_id: str, liked: bool) -> dict:
        row = self._plan_row(plan_id)
        self._ensure_member(plan_id, user_id)
        if not row["vote_place"]:
            fail("В этой сходке место уже выбрано")
        if not self._catalog_place(place_id) and not self._custom_place(plan_id, place_id):
            raise HttpError(404, "Место не найдено")
        if liked:
            self.db.execute("INSERT OR IGNORE INTO votes (plan_id, user_id, place_id) VALUES (?, ?, ?)", (plan_id, user_id, place_id))
        else:
            self.db.execute("DELETE FROM votes WHERE plan_id = ? AND user_id = ? AND place_id = ?", (plan_id, user_id, place_id))
        self.notifier.plan_changed(plan_id)
        return self._build(row, user_id)

    def suggest_place(self, plan_id: str, user_id: int, place: Any) -> dict:
        row = self._plan_row(plan_id)
        self._ensure_member(plan_id, user_id)
        place_id = self._add_custom_place(plan_id, user_id, clean_place(place))
        self.db.execute("INSERT INTO votes (plan_id, user_id, place_id) VALUES (?, ?, ?)", (plan_id, user_id, place_id))
        self.notifier.plan_changed(plan_id)
        return self._build(row, user_id)

    # ---------- решения организатора ----------

    def confirm(self, plan_id: str, user_id: int, key: str, place_id: str | None) -> dict:
        row = self._plan_row(plan_id)
        if row["owner_id"] != user_id:
            raise HttpError(403, "Подтверждает только организатор")
        if key not in slot_keys(json.loads(row["days"]), json.loads(row["times"])):
            fail("Такого слота нет")
        place = place_id or row["place_id"]
        if place and not self._catalog_place(place) and not self._custom_place(plan_id, place):
            fail("Место не найдено")
        date, time = key.split("T")
        self.db.execute(
            """UPDATE plans SET status = 'confirmed', chosen_date = ?, chosen_time = ?, place_id = ?,
                                reminded_day = 0, reminded_soon = 0
               WHERE id = ?""",
            (date, time, place, plan_id),
        )
        # Организатор, который сам не отвечал, тоже идёт на свою сходку.
        self.db.execute(
            "UPDATE members SET status = 'go' WHERE plan_id = ? AND user_id = ? AND status IS NULL",
            (plan_id, user_id),
        )
        self.notifier.plan_confirmed(plan_id)
        return self._build(self._plan_row(plan_id), user_id)

    def nudge(self, plan_id: str, user_id: int) -> int:
        row = self._plan_row(plan_id)
        if row["owner_id"] != user_id:
            raise HttpError(403, "Напоминать может только организатор")
        ids = [m["user_id"] for m in self._member_rows(plan_id) if m["status"] is None and m["user_id"] != user_id]
        # Считаем только тех, до кого сообщение дойдёт: личка с разрешением и группа с карточкой.
        allowed = self.recipients(plan_id, lambda m: True)
        reachable = [uid for uid in ids if uid in allowed]
        sent = len(reachable) + (1 if row["chat_id"] else 0)
        if sent:
            self.notifier.nudge(plan_id, reachable)
        return sent

    # ---------- после встречи ----------

    def set_bill(self, plan_id: str, user_id: int, total: Any) -> dict:
        row = self._plan_row(plan_id)
        self._ensure_member(plan_id, user_id)
        if row["status"] != "confirmed":
            fail("Счёт можно добавить после подтверждения")
        try:
            amount = float(total)
        except (TypeError, ValueError):
            amount = 0
        # Суммы в сумах: счёт компании легко переваливает за миллионы.
        if not 0 < amount < 1_000_000_000:
            fail("Неверная сумма")
        prev = json.loads(row["bill"]) if row["bill"] else None
        bill = {
            "total": round(amount, 2),
            "payerId": user_id,
            "paid": prev["paid"] if prev and prev["payerId"] == user_id else [],
        }
        self.db.execute("UPDATE plans SET bill = ? WHERE id = ?", (json.dumps(bill), plan_id))
        return self._build(self._plan_row(plan_id), user_id)

    def mark_paid(self, plan_id: str, user_id: int, target_id: int, paid: bool) -> dict:
        row = self._plan_row(plan_id)
        if not row["bill"]:
            fail("Счёт ещё не добавлен")
        bill = json.loads(row["bill"])
        if user_id not in (bill["payerId"], target_id):
            raise HttpError(403, "Отметить может плательщик или сам участник")
        paid_set = set(bill["paid"])
        if paid:
            paid_set.add(target_id)
        else:
            paid_set.discard(target_id)
        bill["paid"] = sorted(paid_set)
        self.db.execute("UPDATE plans SET bill = ? WHERE id = ?", (json.dumps(bill), plan_id))
        return self._build(self._plan_row(plan_id), user_id)

    def review(self, plan_id: str, user_id: int, review: dict) -> dict:
        self._plan_row(plan_id)
        self._ensure_member(plan_id, user_id)
        rating = review.get("rating")
        if rating is not None and not (isinstance(rating, int) and 1 <= rating <= 5):
            fail("Оценка — от 1 до 5")
        tags = [str(t) for t in review.get("tags") or [] if len(str(t)) <= 24][:6]
        clean = {"happened": bool(review.get("happened")), "rating": rating, "tags": tags}
        self.db.execute(
            "UPDATE members SET review = ? WHERE plan_id = ? AND user_id = ?",
            (json.dumps(clean, ensure_ascii=False), plan_id, user_id),
        )
        return self._build(self._plan_row(plan_id), user_id)

    # ---------- для бота ----------

    def set_inline_message(self, plan_id: str, inline_message_id: str) -> None:
        self.db.execute("UPDATE plans SET inline_message_id = ? WHERE id = ?", (inline_message_id, plan_id))

    def set_chat_message(self, plan_id: str, chat_id: int, message_id: int) -> None:
        self.db.execute("UPDATE plans SET chat_id = ?, message_id = ? WHERE id = ?", (chat_id, message_id, plan_id))

    def card(self, plan_id: str) -> dict:
        """Данные для карточки в чате."""
        row = self._plan_row(plan_id)
        view = self._build(row, row["owner_id"])
        leading_place = next((p for p in view["places"] if p["votes"] > 0), None)
        return {
            "id": row["id"],
            "title": row["title"],
            "meta": self._meta_line(row),
            "status": view["status"],
            "votePlace": view["votePlace"],
            "deadline": row["deadline"],
            "inlineMessageId": row["inline_message_id"],
            "chatId": row["chat_id"],
            "messageId": row["message_id"],
            "pending": [m["name"] for m in view["members"] if m["status"] is None and not m["isOwner"]],
            "responded": [m["name"] for m in view["members"] if m["status"] is not None],
            "leading": view["top"][0] if view["top"] else None,
            "leadingPlace": leading_place["name"] if leading_place else None,
            "chosen": {"date": row["chosen_date"], "time": row["chosen_time"]} if row["chosen_date"] else None,
            "placeName": self._place_name(row),
            "going": [m["name"] for m in view["members"] if m["status"] == "go"],
        }

    def recipients(self, plan_id: str, keep: Callable[[dict], bool]) -> list[int]:
        """Кому можно написать в личку: участники, разрешившие боту писать."""
        row = self._plan_row(plan_id)
        return [
            m["user_id"]
            for m in self._member_rows(plan_id)
            if m["allows_pm"] and keep({"status": m["status"], "remind": bool(m["remind"]), "isOwner": m["user_id"] == row["owner_id"]})
        ]

    def due_reminders(self, now: datetime) -> list[dict]:
        rows = self.db.execute(
            "SELECT * FROM plans WHERE status = 'confirmed' AND (reminded_day = 0 OR reminded_soon = 0)"
        ).fetchall()
        due = []
        for row in rows:
            start = self._start_of(row)
            if not start:
                continue
            hours_left = (start - now).total_seconds() / 3600
            if hours_left <= 0:
                self.db.execute("UPDATE plans SET reminded_day = 1, reminded_soon = 1 WHERE id = ?", (row["id"],))
            elif hours_left <= 2 and not row["reminded_soon"]:
                self.db.execute("UPDATE plans SET reminded_day = 1, reminded_soon = 1 WHERE id = ?", (row["id"],))
                due.append({"planId": row["id"], "kind": "soon"})
            elif hours_left <= 24 and not row["reminded_day"]:
                self.db.execute("UPDATE plans SET reminded_day = 1 WHERE id = ?", (row["id"],))
                due.append({"planId": row["id"], "kind": "day"})
        return due

    def ics_data(self, plan_id: str) -> dict:
        row = self._plan_row(plan_id)
        if not row["chosen_date"]:
            raise HttpError(404, "Время ещё не выбрано")
        return {
            "title": row["title"],
            "date": row["chosen_date"],
            "time": row["chosen_time"],
            "hours": DURATION_HOURS[row["duration"]],
            "location": self._place_name(row),
        }

    # ---------- внутреннее ----------

    def _plan_row(self, plan_id: str) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
        if not row:
            raise HttpError(404, "Сходка не найдена")
        return row

    def _ensure_member(self, plan_id: str, user_id: int) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO members (plan_id, user_id, joined_at) VALUES (?, ?, ?)",
            (plan_id, user_id, now_iso()),
        )

    def _member_rows(self, plan_id: str) -> list[sqlite3.Row]:
        return self.db.execute(
            """SELECT m.*, u.name, u.allows_pm FROM members m
               JOIN users u ON u.id = m.user_id
               WHERE m.plan_id = ? ORDER BY m.joined_at, m.rowid""",
            (plan_id,),
        ).fetchall()

    def _custom_places(self, plan_id: str) -> list[sqlite3.Row]:
        return self.db.execute("SELECT id, name, url, lat, lng FROM custom_places WHERE plan_id = ?", (plan_id,)).fetchall()

    def _add_custom_place(self, plan_id: str, user_id: int, place: dict) -> str:
        place_id = f"c_{new_id(4)}"
        self.db.execute(
            "INSERT INTO custom_places (id, plan_id, name, url, lat, lng, added_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (place_id, plan_id, place["name"], place["url"], place["lat"], place["lng"], user_id),
        )
        return place_id

    def _custom_place(self, plan_id: str, place_id: str) -> sqlite3.Row | None:
        return next((p for p in self._custom_places(plan_id) if p["id"] == place_id), None)

    def _catalog_place(self, place_id: str) -> dict | None:
        return next((p for p in self.places if p["id"] == place_id), None)

    def _start_of(self, row: sqlite3.Row) -> datetime | None:
        if not row["chosen_date"] or not row["chosen_time"]:
            return None
        # Организатор выбирает время по местному часовому поясу (переменная TZ).
        return datetime.fromisoformat(f"{row['chosen_date']}T{row['chosen_time']}").replace(tzinfo=self.tz)

    def _status_of(self, row: sqlite3.Row) -> str:
        if row["status"] != "confirmed":
            return "collecting"
        start = self._start_of(row)
        if start and start + timedelta(hours=DURATION_HOURS[row["duration"]]) < datetime.now(self.tz):
            return "done"
        return "confirmed"

    def _expired(self, row: sqlite3.Row) -> bool:
        """Сбор так и не подтвердили, а все предложенные дни уже прошли."""
        if row["status"] == "confirmed":
            return False
        return max(json.loads(row["days"])) < datetime.now(self.tz).date().isoformat()

    def _place_name(self, row: sqlite3.Row) -> str | None:
        if not row["place_id"]:
            return None
        known = self._catalog_place(row["place_id"])
        if known:
            return known["name"]
        custom = self._custom_place(row["id"], row["place_id"])
        return custom["name"] if custom else None

    def _meta_line(self, row: sqlite3.Row) -> str:
        budget = None if row["budget"] == "any" else f"{BUDGET_LABELS[row['budget']]} сум"
        parts = [FORMAT_LABELS[row["format"]], budget, days_range_label(json.loads(row["days"]))]
        return " · ".join(p for p in parts if p)

    def _build(self, row: sqlite3.Row, user_id: int) -> dict:
        days = json.loads(row["days"])
        times = json.loads(row["times"])
        keys = slot_keys(days, times)
        members = self._member_rows(row["id"])
        mine = next((m for m in members if m["user_id"] == user_id), None)

        responses = [
            {"name": m["name"], "status": m["status"], "slots": json.loads(m["slots"])}
            for m in members
            if m["status"] is not None
        ]
        heat = {key: sum(1 for r in responses if r["status"] != "no" and r["slots"].get(key)) for key in keys}

        with_area = [m for m in members if m["area_lat"] is not None and m["area_lng"] is not None and m["status"] != "no"]
        all_areas = [{"lat": m["area_lat"], "lng": m["area_lng"]} for m in with_area]
        center = center_of(all_areas)
        owner = next((m for m in members if m["user_id"] == row["owner_id"]), None)

        return {
            "id": row["id"],
            "title": row["title"],
            "format": row["format"],
            "budget": row["budget"],
            "duration": row["duration"],
            "votePlace": bool(row["vote_place"]),
            "middle": bool(row["middle"]),
            "placeId": row["place_id"],
            "inGroup": row["chat_id"] is not None,
            "status": self._status_of(row),
            "deadline": row["deadline"],
            "isOwner": row["owner_id"] == user_id,
            "ownerName": owner["name"] if owner else self.user_name(row["owner_id"]),
            "days": days,
            "times": times,
            "members": [
                {"id": m["user_id"], "name": m["name"], "status": m["status"], "isOwner": m["user_id"] == row["owner_id"]}
                for m in members
            ],
            "me": {
                "id": user_id,
                "status": mine["status"] if mine else None,
                "slots": json.loads(mine["slots"]) if mine else {},
                "area": {"lat": mine["area_lat"], "lng": mine["area_lng"]} if mine and mine["area_lat"] is not None else None,
                "remind": bool(mine["remind"]) if mine else True,
                "review": json.loads(mine["review"]) if mine and mine["review"] else None,
            },
            "areas": [
                {"lat": m["area_lat"], "lng": m["area_lng"], "name": m["name"]}
                for m in with_area
                if m["user_id"] != user_id
            ],
            "heat": heat,
            "responded": len(responses),
            "top": rank_slots(keys, responses)[:3],
            "places": self._place_views(row, user_id, all_areas, center),
            "center": center,
            "chosen": (
                {"date": row["chosen_date"], "time": row["chosen_time"], "placeId": row["place_id"]}
                if row["chosen_date"]
                else None
            ),
            "bill": json.loads(row["bill"]) if row["bill"] else None,
        }

    def _place_views(self, row: sqlite3.Row, user_id: int, areas: list[dict], center: dict | None) -> list[dict]:
        counts = {
            r["place_id"]: r["c"]
            for r in self.db.execute(
                "SELECT place_id, COUNT(*) AS c FROM votes WHERE plan_id = ? GROUP BY place_id", (row["id"],)
            )
        }
        mine = {
            r["place_id"]
            for r in self.db.execute("SELECT place_id FROM votes WHERE plan_id = ? AND user_id = ?", (row["id"], user_id))
        }

        catalog = filter_places(self.places, row["format"], row["budget"])
        chosen = self._catalog_place(row["place_id"]) if row["place_id"] else None
        if chosen and chosen not in catalog:
            catalog.insert(0, chosen)

        views = [
            {
                "id": p["id"],
                "name": p["name"],
                "kind": p["kind"],
                "avgCheck": p["avgCheck"],
                "rating": p.get("rating"),
                "lat": p["lat"],
                "lng": p["lng"],
                "address": p.get("address"),
                "phone": p.get("phone"),
                "url": p.get("url"),
                "promo": p.get("promo"),
                "partner": bool(p.get("partner")),
                "custom": False,
                "votes": counts.get(p["id"], 0),
                "liked": p["id"] in mine,
                "travel": travel_range(p, areas),
            }
            for p in catalog
        ]
        for c in self._custom_places(row["id"]):
            has_point = c["lat"] is not None and c["lng"] is not None
            views.append({
                "id": c["id"],
                "name": c["name"],
                "kind": "Место встречи" if c["id"] == row["place_id"] else "Предложили участники",
                "avgCheck": None,
                "rating": None,
                "lat": c["lat"],
                "lng": c["lng"],
                "address": None,
                "phone": None,
                "url": c["url"],
                "promo": None,
                "partner": False,
                "custom": True,
                "votes": counts.get(c["id"], 0),
                "liked": c["id"] in mine,
                "travel": travel_range({"lat": c["lat"], "lng": c["lng"]}, areas) if has_point else None,
            })

        def distance(p: dict) -> float:
            if center and p["lat"] is not None:
                return distance_km(center, p)
            return float("inf")

        # Место, которое выбрал организатор, всегда первое.
        return sorted(views, key=lambda p: (p["id"] != row["place_id"], -p["votes"], distance(p), -(p["rating"] or 0)))
