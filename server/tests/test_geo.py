from app.geo import parse_places

TASHKENT = {"lat": 41.31, "lng": 69.28}


def feature(name: str, lng: float, lat: float, address: str = "ул. Истикбол, 34") -> dict:
    return {
        "geometry": {"coordinates": [lng, lat]},
        "properties": {"name": name, "CompanyMetaData": {"name": name, "address": address, "Categories": [{"name": "Кафе"}]}},
    }


def test_places_are_local_sorted_and_without_aggregators():
    data = {"features": [
        feature("Lagman House", 69.29, 41.32),
        feature("Resto. uz - рестораны и кафе Ташкента", 69.28, 41.31),
        feature("Шервуд", 30.31, 59.94),  # Санкт-Петербург
        feature("Чайхана «Навруз»", 69.281, 41.311),
    ]}
    places = parse_places(data, TASHKENT)
    assert [p["name"] for p in places] == ["Чайхана «Навруз»", "Lagman House"]
    assert places[0]["lat"] == 41.311 and places[0]["kind"] == "Кафе"
    assert places[0]["distance"] < places[1]["distance"]
