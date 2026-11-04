import asyncio
import logging
from unittest.mock import create_autospec

from telegram import Bot, MenuButtonWebApp
from telegram.error import BadRequest

from app.bot import setup_menu_button
from app.config import Config

CFG = Config(bot_username="skhodka_bot", webapp_url="https://demo.trycloudflare.com")


def test_links_lead_to_main_mini_app_by_default():
    assert CFG.direct_link("p_1") == "https://t.me/skhodka_bot?startapp=p_1"


def test_links_use_short_name_when_set():
    cfg = Config(bot_username="skhodka_bot", app_short_name="app")
    assert cfg.direct_link("new") == "https://t.me/skhodka_bot/app?startapp=new"


def test_menu_button_opens_current_url():
    bot = create_autospec(Bot, instance=True)
    asyncio.run(setup_menu_button(bot, CFG))

    button = bot.set_chat_menu_button.await_args.kwargs["menu_button"]
    assert isinstance(button, MenuButtonWebApp)
    assert (button.text, button.web_app.url) == ("Открыть", "https://demo.trycloudflare.com")


def test_bad_url_does_not_stop_the_server(caplog):
    bot = create_autospec(Bot, instance=True)
    bot.set_chat_menu_button.side_effect = BadRequest("Url must be https")
    with caplog.at_level(logging.WARNING):
        asyncio.run(setup_menu_button(bot, CFG))
    assert "WEBAPP_URL" in caplog.text
