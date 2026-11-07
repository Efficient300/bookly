"""Подписи и даты на русском для сообщений бота (то же, что shared/format.ts в Mini App)."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

FORMAT_LABELS = {
    "eat": "Поесть",
    "coffee": "Кофе",
    "bar": "Бар",
    "active": "Активность",
    "walk": "Прогулка",
    "home": "Дома",
    "any": "Без разницы",
}
# Бюджет на человека в сумах. Верхние границы — в places.BUDGET_MAX.
BUDGET_LABELS = {"1": "до 100 000", "2": "до 250 000", "3": "до 500 000", "any": "Любой"}
DURATION_HOURS = {"1-2": 2, "2-3": 3, "evening": 4}

WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
          "июля", "августа", "сентября", "октября", "ноября", "декабря"]
MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]


def parse_day(day: str) -> date:
    return date.fromisoformat(day)


def weekday_short(day: str) -> str:
    return WEEKDAYS[parse_day(day).weekday()]


def day_label(day: str) -> str:
    """«Сб, 7 ноября»"""
    d = parse_day(day)
    return f"{WEEKDAYS[d.weekday()]}, {d.day} {MONTHS[d.month - 1]}"


def slot_label(day: str, time: str) -> str:
    """«Сб, 7 ноября · 19:00»"""
    return f"{day_label(day)} · {time}"


def days_range_label(days: list[str]) -> str:
    """«Пт–Вс, 6–8 ноября» или «Сб, 7 ноября»."""
    if not days:
        return ""
    first, last = min(days), max(days)
    if first == last:
        return day_label(first)
    a, b = parse_day(first), parse_day(last)
    if a.month == b.month:
        span = f"{a.day}–{b.day} {MONTHS[b.month - 1]}"
    else:
        span = f"{a.day} {MONTHS[a.month - 1]} – {b.day} {MONTHS[b.month - 1]}"
    return f"{weekday_short(first)}–{weekday_short(last)}, {span}"


def deadline_label(iso: str, tz: str) -> str:
    """«ср, 4 ноя, 20:00» — в часовом поясе сервера."""
    moment = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ZoneInfo(tz))
    return f"{WEEKDAYS[moment.weekday()].lower()}, {moment.day} {MONTHS_SHORT[moment.month - 1]}, {moment:%H:%M}"


def join_names(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} и {names[-1]}"
