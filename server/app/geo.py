"""Поиск заведений через API поиска по организациям Яндекса (search-maps.yandex.ru).

Ключ серверный (YANDEX_SEARCH_KEY): Mini App ходит сюда через наш API, поэтому ключ не попадает в браузер.
"""
import re
import time

import httpx

from .places import distance_km

SEARCH_URL = "https://search-maps.yandex.ru/v1/"
# Дальше этого от центра карты — уже другой город.
MAX_DISTANCE_KM = 30
# «Resto.uz», «afisha.uz» и подобные — сайты-агрегаторы, а не заведения.
AGGREGATOR = re.compile(r"\b[\w-]+\s*\.\s*(uz|ru|com|net|org|kz|info)\b", re.IGNORECASE)
CACHE_TTL = 24 * 60 * 60

_cache: dict[tuple, tuple[float, list[dict]]] = {}


def parse_places(data: dict, center: dict) -> list[dict]:
    """Ответ Яндекса → места с координатами и расстоянием, ближние первыми."""
    found = []
    for feature in data.get("features", []):
        coords = (feature.get("geometry") or {}).get("coordinates")
        props = feature.get("properties") or {}
        meta = props.get("CompanyMetaData") or {}
        name = (meta.get("name") or props.get("name") or "").strip()
        if not coords or not name or AGGREGATOR.search(name):
            continue
        point = {"lat": float(coords[1]), "lng": float(coords[0])}
        km = distance_km(center, point)
        if km > MAX_DISTANCE_KM:
            continue
        categories = meta.get("Categories") or []
        found.append({
            **point,
            "name": name,
            "address": meta.get("address") or props.get("description") or None,
            "kind": categories[0].get("name") if categories else None,
            "url": meta.get("url") or None,
            "distance": round(km * 1000),
        })
    return sorted(found, key=lambda p: p["distance"])


async def search_places(key: str, text: str, center: dict) -> list[dict]:
    cache_key = (text.strip().lower(), round(center["lat"], 2), round(center["lng"], 2))
    cached = _cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < CACHE_TTL:
        return cached[1]
    params = {
        "apikey": key,
        "text": text,
        "lang": "ru_RU",
        "type": "biz",
        "ll": f"{center['lng']},{center['lat']}",
        "spn": "0.3,0.25",
        "rspn": "1",  # только внутри области, а не «похожие» из других городов
        "results": "20",
    }
    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.get(SEARCH_URL, params=params)
    response.raise_for_status()
    places = parse_places(response.json(), center)
    _cache[cache_key] = (time.monotonic(), places)
    return places
