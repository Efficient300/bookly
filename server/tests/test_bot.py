import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import create_autospec

from telegram import Bot, MenuButtonWebApp
from telegram.error import BadRequest, Forbidden

from app.bot import BotNotifier, group_menu, setup_menu_button
from app.config import Config
from app.db import open_db
from app.plans import PlanService

CFG = Config(bot_username="skhodka_bot", webapp_url="https://demo.trycloudflare.com")


def test_links_lead_to_main_mini_app_by_default():
    assert CFG.direct_link("p_1") == "https://t.me/skhodka_bot?startapp=p_1&mode=compact"


def test_links_use_short_name_when_set():
    cfg = Config(bot_username="skhodka_bot", app_short_name="app")
    assert cfg.direct_link("new") == "https://t.me/skhodka_bot/app?startapp=new&mode=compact"


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


def make_notifier(status="member"):
    service = PlanService(open_db(":memory:"), [], "Asia/Tashkent")
    service.upsert_user(1, "Аня")
    plan_id = service.create(1, {
        "title": "Кофе <b>", "format": "coffee", "budget": "any", "duration": "1-2", "votePlace": True, "middle": False,
        "days": ["2030-01-05"], "times": ["12:00"], "deadlineHours": None, "placeId": None,
    })
    app = SimpleNamespace(bot=create_autospec(Bot, instance=True))
    app.bot.get_chat_member.return_value = SimpleNamespace(status=status)
    app.bot.send_message.return_value = SimpleNamespace(message_id=77)
    notifier = BotNotifier(app, service, CFG)
    service.notifier = notifier
    return notifier, service, plan_id, app.bot


def test_card_goes_to_group_for_its_member():
    notifier, service, plan_id, bot = make_notifier()
    assert asyncio.run(notifier.post_card(plan_id, -100, 1)) is True
    assert bot.send_message.await_args.args[0] == -100
    card = service.card(plan_id)
    assert (card["chatId"], card["messageId"]) == (-100, 77)
    assert "Кофе &lt;b&gt;" in bot.send_message.await_args.args[1]


def test_card_refuses_stranger_and_private_chat():
    notifier, service, plan_id, bot = make_notifier(status="left")
    assert asyncio.run(notifier.post_card(plan_id, -100, 1)) is False
    assert asyncio.run(notifier.post_card(plan_id, 555, 1)) is False
    bot.send_message.assert_not_awaited()
    assert service.card(plan_id)["chatId"] is None


def test_deleting_marks_card_cancelled():
    notifier, service, plan_id, bot = make_notifier()

    async def scenario():
        await notifier.post_card(plan_id, -100, 1)
        service.delete(plan_id, 1)
        await asyncio.gather(*notifier._tasks)

    asyncio.run(scenario())
    kwargs = bot.edit_message_text.await_args.kwargs
    assert (kwargs["chat_id"], kwargs["message_id"], kwargs["reply_markup"]) == (-100, 77, None)
    assert "отменена" in bot.edit_message_text.await_args.args[0]


def test_group_menu_links_back_to_group():
    notifier, service, plan_id, bot = make_notifier()
    service.set_chat_message(plan_id, -100, 5)
    text, markup = group_menu(service, CFG, -100)
    assert text == "Сходки этой группы:"
    urls = [row[0].url for row in markup.inline_keyboard]
    assert urls == [
        f"https://t.me/skhodka_bot?startapp=p_{plan_id}&mode=compact",
        "https://t.me/skhodka_bot?startapp=new_-100&mode=compact",
        "https://t.me/skhodka_bot?start=notify",
    ]


def test_notifications_go_to_private_chat_not_group():
    notifier, service, plan_id, bot = make_notifier()
    service.set_allows_pm(1, True)

    async def scenario():
        await notifier.post_card(plan_id, -100, 1)
        bot.send_message.reset_mock()
        service.update_me(plan_id, 1, {"status": "go", "slots": {"2030-01-05T12:00": 1}})
        service.confirm(plan_id, 1, "2030-01-05T12:00", None)
        await asyncio.gather(*notifier._tasks)

    asyncio.run(scenario())
    assert [c.args[0] for c in bot.send_message.await_args_list] == [1]
    assert "решено" in bot.send_message.await_args.args[1]


def test_blocked_bot_stops_private_messages():
    notifier, service, plan_id, bot = make_notifier()
    service.set_allows_pm(1, True)
    bot.send_message.side_effect = Forbidden("bot was blocked by the user")
    asyncio.run(notifier._dm([1], "Текст", plan_id))
    assert service.allows_pm(1) is False


def test_answers_are_grouped_for_organizer():
    notifier, service, plan_id, bot = make_notifier()
    service.set_allows_pm(1, True)
    service.upsert_user(2, "Камила")
    service.upsert_user(3, "Тимур")

    async def scenario():
        service.update_me(plan_id, 2, {"status": "go"})
        service.update_me(plan_id, 3, {"status": "no"})
        await asyncio.gather(*notifier._tasks)
        first = [c.args[1] for c in bot.send_message.await_args_list]
        notifier._answer_windows.pop(plan_id).cancel()
        notifier._answer_windows[plan_id] = None
        notifier._close_window(plan_id)
        await asyncio.gather(*notifier._tasks)
        notifier._answer_windows.pop(plan_id).cancel()
        return first, [c.args[1] for c in bot.send_message.await_args_list]

    first, after = asyncio.run(scenario())
    # На момент первого ответа Тимур ещё не открывал сходку.
    assert len(first) == 1 and "Камила" in first[0] and "Ответили 1 из 2" in first[0]
    assert len(after) == 2 and "Тимур (не сможет)" in after[1]


def test_deadline_message_offers_best_option():
    notifier, service, plan_id, bot = make_notifier()
    service.set_allows_pm(1, True)
    service.upsert_user(2, "Камила")

    async def scenario():
        service.update_me(plan_id, 2, {"status": "go", "slots": {"2030-01-05T12:00": 1}})
        notifier._answer_windows.pop(plan_id).cancel()
        bot.send_message.reset_mock()
        notifier.deadline_passed(plan_id)
        await asyncio.gather(*notifier._tasks)

    asyncio.run(scenario())
    markup = bot.send_message.await_args.kwargs["reply_markup"]
    assert markup.inline_keyboard[0][0].callback_data == f"c:{plan_id}:2030-01-05T12:00"
    assert "подходит 1 из 1" in bot.send_message.await_args.args[1]
