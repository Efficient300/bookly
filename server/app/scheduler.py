import asyncio
import logging
from datetime import datetime, timezone

from .plans import Notifier, PlanService

log = logging.getLogger(__name__)


async def run_scheduler(service: PlanService, notifier: Notifier, interval: int = 60) -> None:
    """Раз в минуту: напоминания за сутки и за 2 часа и сообщение организатору, когда вышел срок ответа."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            for item in service.due_reminders(now):
                notifier.remind(item["planId"], item["kind"])
            for plan_id in service.due_deadlines(now):
                notifier.deadline_passed(plan_id)
        except Exception:
            log.exception("Ошибка напоминаний")
        await asyncio.sleep(interval)
