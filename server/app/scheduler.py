import asyncio
import logging
from datetime import datetime, timezone

from .plans import Notifier, PlanService

log = logging.getLogger(__name__)


async def run_scheduler(service: PlanService, notifier: Notifier, interval: int = 60) -> None:
    """Раз в минуту проверяет, кому пора напомнить: за сутки и за 2 часа до встречи."""
    while True:
        try:
            for item in service.due_reminders(datetime.now(timezone.utc)):
                notifier.remind(item["planId"], item["kind"])
        except Exception:
            log.exception("Ошибка напоминаний")
        await asyncio.sleep(interval)
