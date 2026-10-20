"""Event journal per game and day (pk EVLOG#<game>#<YYYY-MM-DD>, list "events"), for future commands
(statistics, history...). Appended atomically; nothing reads it yet."""

import time

from . import store


def log(game, kind, **data):
    try:
        day = time.strftime("%Y-%m-%d", time.gmtime())
        store.append(f"EVLOG#{game}#{day}", "events", dict(data, type=kind, t=int(time.time())))
    except Exception as e:                              # the journal never breaks the bot
        print(f"event log error: {type(e).__name__}")
