"""Файл .ics для Apple/Outlook. Время «плавающее» (без часового пояса):
календарь покажет его как местное — для встреч в одном городе этого достаточно.
"""
from datetime import datetime, timedelta, timezone


def _escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def _floating(date: str, time: str, plus_hours: int = 0) -> str:
    moment = datetime.fromisoformat(f"{date}T{time}") + timedelta(hours=plus_hours)
    return moment.strftime("%Y%m%dT%H%M%S")


def build_ics(uid: str, title: str, date: str, time: str, hours: int, location: str | None) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Skhodka//RU",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        f"UID:{uid}@skhodka",
        f"DTSTAMP:{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}",
        f"DTSTART:{_floating(date, time)}",
        f"DTEND:{_floating(date, time, hours)}",
        f"SUMMARY:{_escape(title)}",
        *([f"LOCATION:{_escape(location)}"] if location else []),
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(lines) + "\r\n"
