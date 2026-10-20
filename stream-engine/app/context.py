"""Which room the running code works for: set when a room's tasks start and for each request to a
room's address, read by the log so every line says whose it is. asyncio tasks inherit it."""

import contextvars

current_room = contextvars.ContextVar("current_room", default="")
