"""Background runtime for the lightweight metadata scheduler."""

import logging
import os
import threading

from .metadata_scheduler_service import initialize_missing_next_run, run_metadata_scheduler_tick

logger = logging.getLogger(__name__)


def _scheduler_enabled() -> bool:
    return os.environ.get("METADATA_SCHEDULER_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def _tick_seconds() -> int:
    raw = os.environ.get("METADATA_SCHEDULER_TICK_SECONDS", "300")
    try:
        return max(30, int(raw))
    except ValueError:
        return 300


def _scheduler_loop(stop_event: threading.Event, tick_seconds: int) -> None:
    try:
        initialize_missing_next_run()
    except Exception:
        logger.exception("Metadata scheduler initialization failed")

    while not stop_event.wait(tick_seconds):
        try:
            run_metadata_scheduler_tick(execute_jobs=True)
        except Exception:
            logger.exception("Metadata scheduler tick failed")


def start_metadata_scheduler(app) -> bool:
    if not _scheduler_enabled():
        app.state.metadata_scheduler_thread = None
        app.state.metadata_scheduler_stop_event = None
        return False
    if getattr(app.state, "metadata_scheduler_thread", None):
        return True

    stop_event = threading.Event()
    thread = threading.Thread(
        target=_scheduler_loop,
        args=(stop_event, _tick_seconds()),
        name="metadata-scheduler",
        daemon=True,
    )
    app.state.metadata_scheduler_stop_event = stop_event
    app.state.metadata_scheduler_thread = thread
    thread.start()
    return True


def stop_metadata_scheduler(app) -> None:
    stop_event = getattr(app.state, "metadata_scheduler_stop_event", None)
    thread = getattr(app.state, "metadata_scheduler_thread", None)
    if stop_event:
        stop_event.set()
    if thread and thread.is_alive():
        thread.join(timeout=2)
    app.state.metadata_scheduler_thread = None
    app.state.metadata_scheduler_stop_event = None
