"""Каталог мест и расчёты расстояний.

Место — словарь из data/places.json: id, name, kind, formats, avgCheck (средний чек в сумах),
rating, lat, lng и необязательные address, phone, url, promo, partner.
"""
import json
import math

LatLng = dict  # {"lat": float, "lng": float}

# Верхняя граница бюджета на человека, сум.
BUDGET_MAX = {"1": 100_000, "2": 250_000, "3": 500_000}


def load_places(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def filter_places(places: list[dict], fmt: str, budget: str) -> list[dict]:
    def ok(p: dict) -> bool:
        format_ok = fmt in ("any", "home") or fmt in p["formats"]
        budget_ok = budget == "any" or p["avgCheck"] <= BUDGET_MAX[budget]
        return format_ok and budget_ok

    return [p for p in places if ok(p)]


def distance_km(a: LatLng, b: LatLng) -> float:
    rad = math.pi / 180
    d_lat = (b["lat"] - a["lat"]) * rad
    d_lng = (b["lng"] - a["lng"]) * rad
    h = math.sin(d_lat / 2) ** 2 + math.cos(a["lat"] * rad) * math.cos(b["lat"] * rad) * math.sin(d_lng / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def travel_minutes(origin: LatLng, dest: LatLng) -> int:
    """Грубая оценка дороги по городу: ~20 км/ч плюс 5 минут на сборы, с шагом 5 минут."""
    minutes = distance_km(origin, dest) / 20 * 60 + 5
    return max(5, round(minutes / 5) * 5)


def travel_range(place: LatLng, areas: list[LatLng]) -> str | None:
    if not areas:
        return None
    minutes = [travel_minutes(a, place) for a in areas]
    lo, hi = min(minutes), max(minutes)
    if len(areas) == 1:
        return f"≈ {lo} мин от вас"
    return f"≈ {lo} мин для всех" if lo == hi else f"{lo}–{hi} мин для всех"


def center_of(points: list[LatLng]) -> LatLng | None:
    if not points:
        return None
    return {
        "lat": sum(p["lat"] for p in points) / len(points),
        "lng": sum(p["lng"] for p in points) / len(points),
    }


def round_area(point: LatLng) -> LatLng:
    """Храним только район: округляем до ~1 км."""
    return {"lat": round(point["lat"], 2), "lng": round(point["lng"], 2)}
