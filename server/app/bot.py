"""Telegram-бот на python-telegram-bot: команды, карточка сходки в чатах, уведомления."""
import asyncio
import logging
import re
from html import escape
from urllib.parse import urlencode

from telegram import (
    Bot,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InlineQueryResultArticle,
    InlineQueryResultsButton,
    InputTextMessageContent,
    MenuButtonWebApp,
    Update,
    WebAppInfo,
)
from telegram.constants import ParseMode
from telegram.error import BadRequest, TelegramError
from telegram.ext import Application, ChosenInlineResultHandler, CommandHandler, ContextTypes, InlineQueryHandler

from .config import Config
from .formatting import deadline_label, join_names, slot_label
from .plans import HttpError, PlanService

log = logging.getLogger(__name__)
PLAN_QUERY = re.compile(r"^p_([\w-]+)$")


def card_text(card: dict, tz: str) -> str:
    title = escape(card["title"])
    if card["status"] != "collecting" and card["chosen"]:
        going = card["going"]
        return "\n".join([
            f"<b>{title}</b> — решено",
            slot_label(card["chosen"]["date"], card["chosen"]["time"]),
            escape(card["placeName"]) if card["placeName"] else "Место уточним",
            "",
            f"Идут: {escape(join_names(going))}" if going else "Пока никто не отметился",
        ])

    if card["votePlace"]:
        place = f"голосуем, впереди {escape(card['leadingPlace'])}" if card["leadingPlace"] else "голосуем"
    else:
        place = escape(card["placeName"]) if card["placeName"] else "решим позже"
    responded = card["responded"]
    lines = [
        f"<b>{title}</b>",
        escape(card["meta"]),
        "",
        f"Ответили {len(responded)}: {escape(join_names(responded))}" if responded else "Пока никто не ответил",
    ]
    if card["leading"]:
        lines.append(f"Лидирует: {slot_label(card['leading']['date'], card['leading']['time'])}")
    lines.append(f"Место: {place}")
    if card["deadline"]:
        lines += ["", f"Ответьте до {deadline_label(card['deadline'], tz)}"]
    return "\n".join(lines)


def card_keyboard(card: dict, cfg: Config) -> InlineKeyboardMarkup:
    # В группах web_app-кнопки не работают — нужна обычная ссылка на Mini App.
    text = "Ответить" if card["status"] == "collecting" else "Открыть"
    return InlineKeyboardMarkup([[InlineKeyboardButton(text, url=cfg.direct_link(f"p_{card['id']}"))]])


def open_button(cfg: Config, start_param: str, text: str) -> InlineKeyboardMarkup:
    url = f"{cfg.webapp_url}?{urlencode({'startapp': start_param})}"
    return InlineKeyboardMarkup([[InlineKeyboardButton(text, web_app=WebAppInfo(url))]])


class BotNotifier:
    """Уведомления из PlanService. Вызывается внутри event loop, сама ставит отправку в фон."""

    def __init__(self, app: Application, service: PlanService, cfg: Config):
        self.app = app
        self.service = service
        self.cfg = cfg
        self._timers: dict[str, asyncio.TimerHandle] = {}
        self._tasks: set[asyncio.Task] = set()

    def _spawn(self, coro) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _refresh_card(self, plan_id: str) -> None:
        card = self.service.card(plan_id)
        if not card["inlineMessageId"]:
            return
        try:
            await self.app.bot.edit_message_text(
                card_text(card, self.cfg.tz),
                inline_message_id=card["inlineMessageId"],
                parse_mode=ParseMode.HTML,
                reply_markup=card_keyboard(card, self.cfg),
            )
        except BadRequest as err:
            if "not modified" not in str(err):
                log.warning("Не удалось обновить карточку %s: %s", plan_id, err)
        except TelegramError as err:
            log.warning("Не удалось обновить карточку %s: %s", plan_id, err)

    async def _dm(self, user_ids: list[int], text: str, plan_id: str) -> None:
        for uid in user_ids:
            try:
                await self.app.bot.send_message(
                    uid, text, parse_mode=ParseMode.HTML, reply_markup=open_button(self.cfg, f"p_{plan_id}", "Открыть")
                )
            except TelegramError as err:
                log.warning("Не удалось написать %s: %s", uid, err)

    def plan_changed(self, plan_id: str) -> None:
        # Склеиваем частые ответы в одно редактирование, чтобы не упереться в лимиты Telegram.
        if timer := self._timers.pop(plan_id, None):
            timer.cancel()
        loop = asyncio.get_running_loop()
        self._timers[plan_id] = loop.call_later(2, lambda: self._spawn(self._refresh_card(plan_id)))

    def plan_confirmed(self, plan_id: str) -> None:
        self._spawn(self._refresh_card(plan_id))
        card = self.service.card(plan_id)
        if not card["chosen"]:
            return
        ids = self.service.recipients(plan_id, lambda m: not m["isOwner"] and m["status"] != "no")
        where = f", {escape(card['placeName'])}" if card["placeName"] else ""
        when = slot_label(card["chosen"]["date"], card["chosen"]["time"])
        self._spawn(self._dm(ids, f"<b>{escape(card['title'])}</b>: решено — {when}{where}", plan_id))

    def nudge(self, plan_id: str, user_ids: list[int]) -> None:
        card = self.service.card(plan_id)
        allowed = set(self.service.recipients(plan_id, lambda m: True))
        text = f"Ждём ваш ответ: <b>{escape(card['title'])}</b>. Когда вам удобно?"
        self._spawn(self._dm([u for u in user_ids if u in allowed], text, plan_id))

    def remind(self, plan_id: str, kind: str) -> None:
        card = self.service.card(plan_id)
        if not card["chosen"]:
            return
        ids = self.service.recipients(plan_id, lambda m: m["status"] != "no" and m["remind"])
        when = "Завтра" if kind == "day" else "Скоро"
        where = f" — {escape(card['placeName'])}" if card["placeName"] else ""
        slot = slot_label(card["chosen"]["date"], card["chosen"]["time"])
        self._spawn(self._dm(ids, f"{when}: <b>{escape(card['title'])}</b>, {slot}{where}. Всё в силе?", plan_id))


async def setup_menu_button(bot: Bot, cfg: Config) -> None:
    """Кнопка Mini App рядом с полем ввода. Ставим при каждом запуске: адрес туннеля меняется."""
    try:
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp("Открыть", WebAppInfo(cfg.webapp_url)))
    except TelegramError as e:
        log.warning("Не удалось поставить кнопку Mini App: %s. Проверьте WEBAPP_URL — нужен адрес https.", e)


def create_bot(service: PlanService, cfg: Config) -> tuple[Application, BotNotifier]:
    app = Application.builder().token(cfg.bot_token).build()

    async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        payload = context.args[0] if context.args else ""
        chat = update.effective_chat
        if chat and chat.type != "private":
            await update.effective_message.reply_text(
                "Соберём всех: отметьте, когда удобно, и выберем место.",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Создать сходку", url=cfg.direct_link("new"))]]),
            )
            return
        text = "Открыть сходку" if payload.startswith("p_") else "Открыть Сходку"
        await update.effective_message.reply_text(
            "Сходка помогает договориться о встрече: когда всем удобно и куда пойти.\n\n"
            "Создайте сходку и отправьте её в чат с друзьями.",
            reply_markup=open_button(cfg, payload or "home", text),
        )

    async def plan_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.effective_message.reply_text(
            "Соберём всех: отметьте, когда удобно, и выберем место.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("Создать сходку", url=cfg.direct_link("new"))]]),
        )

    # Mini App вызывает switchInlineQuery("p_<id>") — здесь отдаём карточку для выбранного чата.
    async def inline_query(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.inline_query
        match = PLAN_QUERY.match(query.query.strip())
        card = None
        if match:
            try:
                card = service.card(match.group(1))
            except HttpError:
                card = None
        if not card:
            await query.answer(
                [],
                cache_time=0,
                is_personal=True,
                button=InlineQueryResultsButton("Создать сходку", web_app=WebAppInfo(f"{cfg.webapp_url}?startapp=new")),
            )
            return
        await query.answer(
            [
                InlineQueryResultArticle(
                    id=card["id"],
                    title=f"Отправить «{card['title']}»",
                    description=card["meta"],
                    input_message_content=InputTextMessageContent(card_text(card, cfg.tz), parse_mode=ParseMode.HTML),
                    reply_markup=card_keyboard(card, cfg),
                )
            ],
            cache_time=0,
            is_personal=True,
        )

    # Нужен /setinlinefeedback в @BotFather — иначе id сообщения не придёт и карточка не будет обновляться.
    async def chosen_result(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        result = update.chosen_inline_result
        if result.inline_message_id:
            service.set_inline_message(result.result_id, result.inline_message_id)

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("plan", plan_command))
    app.add_handler(InlineQueryHandler(inline_query))
    app.add_handler(ChosenInlineResultHandler(chosen_result))
    return app, BotNotifier(app, service, cfg)
