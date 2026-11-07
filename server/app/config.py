import os
from dataclasses import dataclass
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent


def load_env(path: Path = SERVER_DIR / ".env") -> None:
    """Простейший .env: строки KEY=VALUE, # — комментарии. Уже заданные переменные не трогаем."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def _path(value: str) -> str:
    """Относительные пути считаем от папки server, а не от текущей директории."""
    return str(Path(value) if Path(value).is_absolute() else SERVER_DIR / value)


@dataclass(frozen=True)
class Config:
    bot_token: str = ""
    bot_username: str = ""
    app_short_name: str = ""
    webapp_url: str = "http://localhost:5173"
    host: str = "0.0.0.0"
    port: int = 8787
    db_path: str = _path("data/skhodka.db")
    static_dir: str = _path("../webapp/dist")
    places_path: str = _path("data/places.json")
    tz: str = "Asia/Tashkent"
    dev_mode: bool = False
    # Ключ «API поиска по организациям» Яндекса: координаты найденных заведений.
    yandex_search_key: str = ""
    # Сколько секунд считать initData свежими.
    init_data_ttl: int = 24 * 60 * 60

    @classmethod
    def from_env(cls) -> "Config":
        load_env()
        env = os.environ.get
        return cls(
            bot_token=env("BOT_TOKEN", ""),
            bot_username=env("BOT_USERNAME", ""),
            app_short_name=env("APP_SHORT_NAME", ""),
            webapp_url=env("WEBAPP_URL", "http://localhost:5173"),
            host=env("HOST", "0.0.0.0"),
            port=int(env("PORT", "8787")),
            db_path=_path(env("DB_PATH", "data/skhodka.db")),
            static_dir=_path(env("STATIC_DIR", "../webapp/dist")),
            places_path=_path(env("PLACES_PATH", "data/places.json")),
            tz=env("TZ", "Asia/Tashkent"),
            dev_mode=env("DEV_MODE") == "1",
            yandex_search_key=env("YANDEX_SEARCH_KEY", ""),
            init_data_ttl=int(env("INIT_DATA_TTL", str(24 * 60 * 60))),
        )

    def direct_link(self, start_param: str) -> str:
        """Прямая ссылка на Mini App: работает в группах, в отличие от web_app-кнопок.

        Без короткого имени ведёт на главное Mini App бота (включается в @BotFather).
        mode=compact открывает Mini App снизу, на половину экрана.
        """
        app = f"/{self.app_short_name}" if self.app_short_name else ""
        return f"https://t.me/{self.bot_username}{app}?startapp={start_param}&mode=compact"
