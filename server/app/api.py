"""HTTP API для Mini App (Starlette — та же основа, что у FastAPI, но без скомпилированных зависимостей)."""
import json
import logging
from pathlib import Path

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .config import Config
from .ics import build_ics
from .init_data import InitDataError, validate_init_data
from .plans import HttpError, PlanService

log = logging.getLogger(__name__)

# Тестовые пользователи для DEV_MODE: ?dev_user=1..6 в адресе Mini App.
DEV_USERS = {1: "Аня", 2: "Тимур", 3: "Сардор", 4: "Лена", 5: "Дима", 6: "Карина"}


class SpaFiles(StaticFiles):
    """Раздаёт собранную Mini App; неизвестные пути отдают index.html."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            return await super().get_response("index.html", scope)


def create_app(service: PlanService, cfg: Config, lifespan=None) -> Starlette:
    def user_id(request: Request) -> int:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("tma "):
            data = validate_init_data(auth[4:], cfg.bot_token, cfg.init_data_ttl)
            u = data.user
            service.upsert_user(
                u["id"],
                " ".join(filter(None, [u.get("first_name"), u.get("last_name")])),
                u.get("username"),
                u.get("allows_write_to_pm"),
            )
            return u["id"]
        if cfg.dev_mode and auth.startswith("dev "):
            uid = int(auth[4:]) if auth[4:].isdigit() else 0
            if uid not in DEV_USERS:
                raise HttpError(403, "Нет такого тестового пользователя")
            service.upsert_user(uid, DEV_USERS[uid], allows_pm=False)
            return uid
        raise HttpError(401, "Откройте приложение из Telegram")

    async def body(request: Request) -> dict:
        data = await request.json()
        if not isinstance(data, dict):
            raise HttpError(400, "Ожидался JSON-объект")
        return data

    def pid(request: Request) -> str:
        return request.path_params["id"]

    # ---------- обработчики ----------

    async def event_ics(request: Request) -> Response:
        # Публичная ссылка: id сходки случайный, угадать его нельзя.
        data = service.ics_data(pid(request))
        return Response(
            build_ics(uid=pid(request), **data),
            media_type="text/calendar; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="skhodka.ics"'},
        )

    async def me(request: Request):
        uid = user_id(request)
        return JSONResponse({"id": uid, "name": service.user_name(uid)})

    async def write_access(request: Request):
        uid = user_id(request)
        service.set_allows_pm(uid, bool((await body(request)).get("allowed")))
        return JSONResponse({"ok": True})

    async def plans(request: Request):
        uid = user_id(request)
        if request.method == "POST":
            data = await body(request)
            plan_id = service.create(uid, data)
            chat_id = data.get("chatId")
            # Mini App, открытая кнопкой из группы, передаёт id группы: бот сам отправит туда карточку.
            posted = type(chat_id) is int and await service.notifier.post_card(plan_id, chat_id, uid)
            return JSONResponse({"id": plan_id, "posted": posted}, status_code=201)
        return JSONResponse(service.list_for_user(uid))

    async def plan(request: Request):
        uid = user_id(request)
        if request.method == "DELETE":
            service.delete(pid(request), uid)
            return JSONResponse({"ok": True})
        return JSONResponse(service.view(pid(request), uid))

    async def update_me(request: Request):
        uid = user_id(request)
        return JSONResponse(service.update_me(pid(request), uid, await body(request)))

    async def votes(request: Request):
        uid = user_id(request)
        data = await body(request)
        return JSONResponse(service.vote(pid(request), uid, str(data.get("placeId")), bool(data.get("liked"))))

    async def suggest(request: Request):
        uid = user_id(request)
        data = await body(request)
        return JSONResponse(service.suggest_place(pid(request), uid, data))

    async def confirm(request: Request):
        uid = user_id(request)
        data = await body(request)
        return JSONResponse(service.confirm(pid(request), uid, str(data.get("key")), data.get("placeId")))

    async def nudge(request: Request):
        return JSONResponse({"sent": service.nudge(pid(request), user_id(request))})

    async def bill(request: Request):
        uid = user_id(request)
        return JSONResponse(service.set_bill(pid(request), uid, (await body(request)).get("total")))

    async def bill_paid(request: Request):
        uid = user_id(request)
        data = await body(request)
        try:
            target = int(data.get("userId"))
        except (TypeError, ValueError):
            raise HttpError(400, "Неверный участник")
        return JSONResponse(service.mark_paid(pid(request), uid, target, bool(data.get("paid"))))

    async def review(request: Request):
        uid = user_id(request)
        return JSONResponse(service.review(pid(request), uid, await body(request)))

    # ---------- ошибки ----------

    async def on_http_error(request: Request, exc: HttpError):
        return JSONResponse({"error": exc.message}, status_code=exc.status)

    async def on_init_data_error(request: Request, exc: InitDataError):
        return JSONResponse({"error": str(exc)}, status_code=401)

    async def on_bad_json(request: Request, exc: json.JSONDecodeError):
        return JSONResponse({"error": "Неверный JSON"}, status_code=400)

    async def on_error(request: Request, exc: Exception):
        log.exception("Ошибка запроса", exc_info=exc)
        return JSONResponse({"error": "Внутренняя ошибка"}, status_code=500)

    routes = [
        Route("/api/plans/{id}/event.ics", event_ics, methods=["GET"]),
        Route("/api/me", me, methods=["GET"]),
        Route("/api/me/write-access", write_access, methods=["POST"]),
        Route("/api/plans", plans, methods=["GET", "POST"]),
        Route("/api/plans/{id}", plan, methods=["GET", "DELETE"]),
        Route("/api/plans/{id}/me", update_me, methods=["PATCH"]),
        Route("/api/plans/{id}/votes", votes, methods=["POST"]),
        Route("/api/plans/{id}/places", suggest, methods=["POST"]),
        Route("/api/plans/{id}/confirm", confirm, methods=["POST"]),
        Route("/api/plans/{id}/nudge", nudge, methods=["POST"]),
        Route("/api/plans/{id}/bill", bill, methods=["PUT"]),
        Route("/api/plans/{id}/bill/paid", bill_paid, methods=["POST"]),
        Route("/api/plans/{id}/review", review, methods=["PUT"]),
    ]
    # В продакшене сервер сам раздаёт собранную Mini App (npm run build).
    if Path(cfg.static_dir, "index.html").exists():
        routes.append(Mount("/", app=SpaFiles(directory=cfg.static_dir, html=True)))

    return Starlette(
        routes=routes,
        lifespan=lifespan,
        exception_handlers={
            HttpError: on_http_error,
            InitDataError: on_init_data_error,
            json.JSONDecodeError: on_bad_json,
            Exception: on_error,
        },
    )
