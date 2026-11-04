"""Точка входа: API и бот в одном процессе. Запуск из папки server: python -m app.main"""
import asyncio
import contextlib
import logging

import uvicorn
from telegram import Update

from .api import create_app
from .bot import create_bot, setup_commands, setup_menu_button
from .config import Config
from .db import open_db
from .places import load_places
from .plans import PlanService
from .scheduler import run_scheduler

log = logging.getLogger("skhodka")


def build(cfg: Config):
    service = PlanService(open_db(cfg.db_path), load_places(cfg.places_path), cfg.tz)
    bot_app = None
    if cfg.bot_token:
        bot_app, notifier = create_bot(service, cfg)
        service.notifier = notifier

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        scheduler = None
        if bot_app:
            await bot_app.initialize()
            await bot_app.start()
            await setup_menu_button(bot_app.bot, cfg)
            await setup_commands(bot_app.bot)
            await bot_app.updater.start_polling(
                allowed_updates=[Update.MESSAGE, Update.INLINE_QUERY, Update.CHOSEN_INLINE_RESULT, Update.MY_CHAT_MEMBER]
            )
            scheduler = asyncio.create_task(run_scheduler(service, service.notifier))
            log.info("Бот @%s запущен", bot_app.bot.username)
        else:
            log.warning("BOT_TOKEN не задан — бот выключен, работает только API.")
        if cfg.dev_mode:
            log.warning("DEV_MODE=1: вход без Telegram разрешён. Не включайте это в продакшене.")
        try:
            yield
        finally:
            if bot_app:
                scheduler.cancel()
                await bot_app.updater.stop()
                await bot_app.stop()
                await bot_app.shutdown()

    return create_app(service, cfg, lifespan=lifespan)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    cfg = Config.from_env()
    uvicorn.run(build(cfg), host=cfg.host, port=cfg.port, log_level="info")


if __name__ == "__main__":
    main()
