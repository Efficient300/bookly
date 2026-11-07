"""Telegram-бот на python-telegram-bot: команды, карточка сходки в чатах, уведомления."""
import asyncio
import logging
import re
from html import escape
from urllib.parse import urlencode

from telegram import (
    Bot,
    BotCommand,
    BotCommandScopeAllGroupChats,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InlineQueryResultArticle,
    InlineQueryResultsButton,
    InputTextMessageContent,
    CallbackQuery,
    MenuButtonWebApp,
    ReplyParameters,
    Update,
    WebAppInfo,
)
from telegram.constants import ParseMode
from telegram.error import BadRequest, Forbidden, TelegramError
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    ChatMemberHandler,
    ChosenInlineResultHandler,
    CommandHandler,
    ContextTypes,
    InlineQueryHandler,
)

from .config import Config
from .formatting import deadline_label, join_names, slot_label
from .plans import HttpError, PlanService

log = logging.getLogger(__name__)
PLAN_QUERY = re.compile(r"^p_([\w-]+)$")
CONFIRM_DATA = re.compile(r"^c:([\w-]+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$")
# Ответы друзей организатору — не чаще одного сообщения за это время.
ANSWER_WINDOW = 30 * 60
STATUS_WORDS = {"go": "идёт", "maybe": "может быть", "no": "не может"}


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


def route_url(point: dict) -> str:
    return f"https://yandex.uz/maps/?rtext=~{point['lat']},{point['lng']}&rtt=auto"


def card_keyboard(card: dict, cfg: Config) -> InlineKeyboardMarkup:
    # В группах web_app-кнопки не работают — нужна обычная ссылка на Mini App.
    text = "Ответить" if card["status"] == "collecting" else "Открыть"
    return InlineKeyboardMarkup([[InlineKeyboardButton(text, url=cfg.direct_link(f"p_{card['id']}"))]])


def open_button(cfg: Config, start_param: str, text: str) -> InlineKeyboardMarkup:
    url = f"{cfg.webapp_url}?{urlencode({'startapp': start_param})}"
    return InlineKeyboardMarkup([[InlineKeyboardButton(text, web_app=WebAppInfo(url))]])


def group_menu(service: PlanService, cfg: Config, chat_id: int) -> tuple[str, InlineKeyboardMarkup]:
    """Сообщение для группы: создать сходку и открыть текущие. Сходка сама придёт карточкой в эту группу."""
    plans = service.list_for_chat(chat_id)[:5]
    rows = [[InlineKeyboardButton(p["title"], url=cfg.direct_link(f"p_{p['id']}"))] for p in plans]
    rows.append([InlineKeyboardButton("Создать сходку", url=cfg.direct_link(f"new_{chat_id}"))])
    rows.append([InlineKeyboardButton("Получать уведомления в личку", url=f"https://t.me/{cfg.bot_username}?start=notify")])
    text = "Сходки этой группы:" if plans else "Соберём всех: отметьте, когда удобно, и выберем место."
    return text, InlineKeyboardMarkup(rows)


class BotNotifier:
    """Уведомления из PlanService. Вызывается внутри event loop, сама ставит отправку в фон."""

    def __init__(self, app: Application, service: PlanService, cfg: Config):
        self.app = app
        self.service = service
        self.cfg = cfg
        self._timers: dict[str, asyncio.TimerHandle] = {}
        # Окно, в котором ответы копятся, и сами ответы.
        self._answer_windows: dict[str, asyncio.TimerHandle] = {}
        self._answer_queue: dict[str, list[str]] = {}
        self._tasks: set[asyncio.Task] = set()

    def _spawn(self, coro) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _edit_card(self, card: dict, text: str, markup: InlineKeyboardMarkup | None) -> None:
        # Карточка могла уйти и через inline-режим, и напрямую в группу: обновляем обе.
        targets = []
        if card["inlineMessageId"]:
            targets.append({"inline_message_id": card["inlineMessageId"]})
        if card["chatId"] and card["messageId"]:
            targets.append({"chat_id": card["chatId"], "message_id": card["messageId"]})
        for target in targets:
            try:
                await self.app.bot.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=markup, **target)
            except BadRequest as err:
                if "not modified" not in str(err):
                    log.warning("Не удалось обновить карточку %s: %s", card["id"], err)
            except TelegramError as err:
                log.warning("Не удалось обновить карточку %s: %s", card["id"], err)

    async def _refresh_card(self, plan_id: str) -> None:
        try:
            card = self.service.card(plan_id)
        except HttpError:
            return  # Сходку уже удалили.
        await self._edit_card(card, card_text(card, self.cfg.tz), card_keyboard(card, self.cfg))

    async def _to_group(self, card: dict, text: str) -> None:
        """Сообщение в группу — только по просьбе организатора: остальные уведомления идут в личку."""
        if not card["chatId"]:
            return
        try:
            await self.app.bot.send_message(
                card["chatId"],
                text,
                parse_mode=ParseMode.HTML,
                reply_markup=card_keyboard(card, self.cfg),
                reply_parameters=(
                    ReplyParameters(card["messageId"], allow_sending_without_reply=True) if card["messageId"] else None
                ),
            )
        except TelegramError as err:
            log.warning("Не удалось написать в группу %s: %s", card["chatId"], err)

    async def post_card(self, plan_id: str, chat_id: int, user_id: int) -> bool:
        """Отправляет карточку в группу. id группы приходит из ссылки, поэтому проверяем, что автор в ней состоит."""
        if chat_id >= 0:
            return False
        try:
            member = await self.app.bot.get_chat_member(chat_id, user_id)
            if member.status in ("left", "kicked"):
                return False
            card = self.service.card(plan_id)
            message = await self.app.bot.send_message(
                chat_id, card_text(card, self.cfg.tz), parse_mode=ParseMode.HTML, reply_markup=card_keyboard(card, self.cfg)
            )
        except TelegramError as err:
            log.warning("Не удалось отправить карточку в группу %s: %s", chat_id, err)
            return False
        self.service.set_chat_message(plan_id, chat_id, message.message_id)
        people = self.service.chat_people(chat_id, user_id)
        self._spawn(self._dm(people, f"Новая сходка в группе: <b>{escape(card['title'])}</b>. Когда вам удобно?", plan_id))
        return True

    async def _dm(
        self, user_ids: list[int], text: str, plan_id: str | None, markup: InlineKeyboardMarkup | None = None
    ) -> None:
        if markup is None and plan_id:
            markup = open_button(self.cfg, f"p_{plan_id}", "Открыть")
        for uid in user_ids:
            try:
                await self.app.bot.send_message(uid, text, parse_mode=ParseMode.HTML, reply_markup=markup)
            except Forbidden:
                # Человек заблокировал бота: больше не пытаемся.
                self.service.set_allows_pm(uid, False)
            except TelegramError as err:
                log.warning("Не удалось написать %s: %s", uid, err)

    def plan_created(self, plan_id: str) -> None:
        card = self.service.card(plan_id)
        ids = self.service.recipients(plan_id, lambda m: m["isOwner"])
        text = f"Сходка <b>{escape(card['title'])}</b> создана. Напишу сюда, когда кто-нибудь ответит."
        self._spawn(self._dm(ids, text, plan_id))

    def member_answered(self, plan_id: str, name: str, status: str) -> None:
        who = name if status != "no" else f"{name} (не сможет)"
        if plan_id in self._answer_windows:
            self._answer_queue.setdefault(plan_id, []).append(who)
            return
        self._send_answers(plan_id, [who])

    def _send_answers(self, plan_id: str, names: list[str]) -> None:
        try:
            card = self.service.card(plan_id)
        except HttpError:
            return
        ids = self.service.recipients(plan_id, lambda m: m["isOwner"])
        head = "Новый ответ" if len(names) == 1 else "Новые ответы"
        done = len(card["responded"])
        text = f"{head} на «{escape(card['title'])}»: {escape(join_names(names))}. Ответили {done} из {card['total']}."
        if done == card["total"]:
            text += " Все ответили — можно выбирать время."
        self._spawn(self._dm(ids, text, plan_id))
        loop = asyncio.get_running_loop()
        self._answer_windows[plan_id] = loop.call_later(ANSWER_WINDOW, lambda: self._close_window(plan_id))

    def _close_window(self, plan_id: str) -> None:
        self._answer_windows.pop(plan_id, None)
        names = self._answer_queue.pop(plan_id, [])
        if names:
            self._send_answers(plan_id, names)

    def deadline_passed(self, plan_id: str) -> None:
        try:
            card = self.service.card(plan_id)
        except HttpError:
            return
        ids = self.service.recipients(plan_id, lambda m: m["isOwner"])
        title = escape(card["title"])
        best = card["leading"]
        if not best:
            text = f"Время ответов по «{title}» вышло, но никто не отметил время."
            self._spawn(self._dm(ids, text, plan_id))
            return
        place = card["placeName"] or card["leadingPlace"]
        text = (
            f"Время ответов по «{title}» вышло. Лучший вариант: <b>{slot_label(best['date'], best['time'])}</b>, "
            f"подходит {best['good'] + best['maybe']} из {len(card['responded'])}."
            + (f" Место: {escape(place)}." if place else "")
        )
        markup = InlineKeyboardMarkup([
            [InlineKeyboardButton("Подтвердить и сообщить всем", callback_data=f"c:{plan_id}:{best['key']}")],
            [InlineKeyboardButton("Выбрать другой вариант", web_app=WebAppInfo(f"{self.cfg.webapp_url}?startapp=p_{plan_id}"))],
        ])
        self._spawn(self._dm(ids, text, plan_id, markup))

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
        ids = self.service.recipients(plan_id, lambda m: m["status"] != "no")
        where = f", {escape(card['placeName'])}" if card["placeName"] else ""
        when = slot_label(card["chosen"]["date"], card["chosen"]["time"])
        self._spawn(self._dm(ids, f"<b>{escape(card['title'])}</b>: решено — {when}{where}", plan_id))

    def nudge(self, plan_id: str, user_ids: list[int]) -> None:
        card = self.service.card(plan_id)
        allowed = set(self.service.recipients(plan_id, lambda m: True))
        text = f"Ждём ваш ответ: <b>{escape(card['title'])}</b>. Когда вам удобно?"
        self._spawn(self._dm([u for u in user_ids if u in allowed], text, plan_id))
        names = f" {escape(join_names(card['pending']))}," if card["pending"] else ""
        self._spawn(self._to_group(card, f"Ждём ответы{names} по сходке <b>{escape(card['title'])}</b>."))

    def remind(self, plan_id: str, kind: str) -> None:
        card = self.service.card(plan_id)
        if not card["chosen"]:
            return
        ids = self.service.recipients(plan_id, lambda m: m["status"] != "no" and m["remind"])
        when = "Завтра" if kind == "day" else "Скоро"
        where = f" — {escape(card['placeName'])}" if card["placeName"] else ""
        slot = slot_label(card["chosen"]["date"], card["chosen"]["time"])
        if kind == "soon":
            address = f", {escape(card['placeAddress'])}" if card["placeAddress"] else ""
            text = f"Через 2 часа сходка «{escape(card['title'])}». {escape(card['placeName'] or 'Место уточним')}{address}."
        else:
            text = f"{when}: <b>{escape(card['title'])}</b>, {slot}{where}. Всё в силе?"
        rows = [[InlineKeyboardButton("Маршрут", url=route_url(card["placePoint"]))]] if card["placePoint"] else []
        rows.append([InlineKeyboardButton("Открыть", web_app=WebAppInfo(f"{self.cfg.webapp_url}?startapp=p_{plan_id}"))])
        self._spawn(self._dm(ids, text, plan_id, InlineKeyboardMarkup(rows)))

    def plan_deleted(self, card: dict, user_ids: list[int]) -> None:
        if timer := self._timers.pop(card["id"], None):
            timer.cancel()
        text = f"<s>{escape(card['title'])}</s>\nСходка отменена"
        self._spawn(self._edit_card(card, text, None))
        self._spawn(self._dm(user_ids, text, None))


async def setup_menu_button(bot: Bot, cfg: Config) -> None:
    """Кнопка Mini App рядом с полем ввода. Ставим при каждом запуске: адрес туннеля меняется."""
    try:
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp("Открыть", WebAppInfo(cfg.webapp_url)))
    except TelegramError as e:
        log.warning("Не удалось поставить кнопку Mini App: %s. Проверьте WEBAPP_URL — нужен адрес https.", e)


async def setup_commands(bot: Bot) -> None:
    """Подсказка команд в группах: набрал «/» — видишь, как открыть сходки."""
    try:
        await bot.set_my_commands(
            [BotCommand("plan", "Создать сходку или открыть текущие")], scope=BotCommandScopeAllGroupChats()
        )
    except TelegramError as e:
        log.warning("Не удалось задать команды бота: %s", e)


def create_bot(service: PlanService, cfg: Config) -> tuple[Application, BotNotifier]:
    app = Application.builder().token(cfg.bot_token).build()

    async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        payload = context.args[0] if context.args else ""
        chat = update.effective_chat
        if chat and chat.type != "private":
            text, markup = group_menu(service, cfg, chat.id)
            await update.effective_message.reply_text(text, reply_markup=markup)
            return
        # Человек сам написал боту — значит, в личку можно присылать уведомления.
        user = update.effective_user
        service.upsert_user(user.id, user.full_name, user.username, allows_pm=True)
        if payload == "notify":
            await update.effective_message.reply_text(
                "Готово! Уведомления о сходках будут приходить сюда.",
                reply_markup=open_button(cfg, "home", "Открыть Сходку"),
            )
            return
        if payload.startswith("p_"):
            await update.effective_message.reply_text("Вот сходка:", reply_markup=open_button(cfg, payload, "Открыть сходку"))
            return
        await update.effective_message.reply_text(
            "Сходка помогает собраться с друзьями.\n\n"
            "1. Создайте сходку: дни, время и место.\n"
            "2. Отправьте её в чат с друзьями.\n"
            "3. Мы найдём время, которое подходит всем.\n\n"
            "Ответы и итог будут приходить сюда.",
            reply_markup=open_button(cfg, "new", "Создать сходку"),
        )

    async def plan_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        chat = update.effective_chat
        if chat.type == "private":
            await update.effective_message.reply_text(
                "Откройте приложение и создайте сходку.", reply_markup=open_button(cfg, "new", "Создать сходку")
            )
            return
        text, markup = group_menu(service, cfg, chat.id)
        await update.effective_message.reply_text(text, reply_markup=markup)

    # Бота добавили в группу — сразу показываем, как им пользоваться.
    async def added_to_chat(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        change = update.my_chat_member
        was_out = change.old_chat_member.status in ("left", "kicked")
        is_in = change.new_chat_member.status not in ("left", "kicked")
        # В личке это блокировка и разблокировка бота.
        if change.chat.type == "private":
            service.set_allows_pm(change.chat.id, is_in)
            return
        if not (was_out and is_in and change.chat.type in ("group", "supergroup")):
            return
        text, markup = group_menu(service, cfg, change.chat.id)
        try:
            await context.bot.send_message(change.chat.id, text, reply_markup=markup)
        except TelegramError as err:
            log.warning("Не удалось поздороваться в группе %s: %s", change.chat.id, err)

    # Кнопка «Подтвердить и сообщить всем» из сообщения о сроке ответа.
    async def confirm_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query: CallbackQuery = update.callback_query
        match = CONFIRM_DATA.match(query.data or "")
        if not match:
            await query.answer()
            return
        plan_id, key = match.groups()
        try:
            card = service.card(plan_id)
            if card["ownerId"] != query.from_user.id:
                await query.answer("Подтверждает только организатор", show_alert=True)
                return
            service.confirm(plan_id, query.from_user.id, key, card["placeId"] or card["leadingPlaceId"])
        except HttpError as err:
            await query.answer(err.message, show_alert=True)
            return
        date, time = key.split("T")
        await query.answer("Готово, всем сообщили")
        await query.edit_message_text(
            f"Подтверждено: <b>{escape(card['title'])}</b>, {slot_label(date, time)}.",
            parse_mode=ParseMode.HTML,
            reply_markup=open_button(cfg, f"p_{plan_id}", "Открыть"),
        )

    def inline_article(card: dict) -> InlineQueryResultArticle:
        return InlineQueryResultArticle(
            id=card["id"],
            title=f"Отправить «{card['title']}»",
            description=card["meta"],
            input_message_content=InputTextMessageContent(card_text(card, cfg.tz), parse_mode=ParseMode.HTML),
            reply_markup=card_keyboard(card, cfg),
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
            # Просто «@бот» в чате — предлагаем свои актуальные сходки.
            mine = [
                p for p in service.list_for_user(query.from_user.id)
                if p["isOwner"] and p["status"] != "done" and not p["expired"]
            ]
            await query.answer(
                [inline_article(service.card(p["id"])) for p in mine[:10]],
                cache_time=0,
                is_personal=True,
                button=InlineQueryResultsButton("Создать сходку", web_app=WebAppInfo(f"{cfg.webapp_url}?startapp=new")),
            )
            return
        await query.answer([inline_article(card)], cache_time=0, is_personal=True)

    # Нужен /setinlinefeedback в @BotFather — иначе id сообщения не придёт и карточка не будет обновляться.
    async def chosen_result(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        result = update.chosen_inline_result
        if result.inline_message_id:
            service.set_inline_message(result.result_id, result.inline_message_id)

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("plan", plan_command))
    app.add_handler(ChatMemberHandler(added_to_chat, ChatMemberHandler.MY_CHAT_MEMBER))
    app.add_handler(CallbackQueryHandler(confirm_button))
    app.add_handler(InlineQueryHandler(inline_query))
    app.add_handler(ChosenInlineResultHandler(chosen_result))
    return app, BotNotifier(app, service, cfg)
