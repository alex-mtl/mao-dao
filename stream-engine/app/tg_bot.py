"""The Mini App's bot and its rooms: one room per Telegram group (2026-11-04).

Players of a group compete only with each other: every group the bot is added to gets its own engine room
("tgg_<code>"), the code being a random key the bot puts into the group's "play" link
(t.me/<bot>?startapp=g<code>). Telegram signs the link's parameter into initData (start_param), so the gate
knows the room; a random code (not the chat id) keeps strangers out of a group's room.
A link without a code (the bot's private chat, its menu button) opens the common room TG_APP_ROOM.

Rooms live only while played: nobody for TG_APP_IDLE_SEC -> the game pauses (tg_app.TgApp.idle_check),
nobody for TG_APP_UNLOAD_SEC -> the room is stopped and dropped from memory (its state stays on disk, the round
still paused); the first player back loads and starts it again.

The bot's updates come to POST /tg/hook (Telegram's webhook, secret header). It answers:
  added to a group -> a welcome with the "play" button;   /play -> the button again;
  /settings (group admins) -> the button of the admin panel: the same page, start_param a<code>; the gate asks
  Telegram whether that user is an admin of that group before the page gets the panel.
"""

import asyncio
import hashlib
import json
import secrets
import time

from . import config
from .tg_app import TgApp, init_data_fields

GROUP_PREFIX = "tgg_"
PLAY_TEXT = ("🎯 <b>Угадай слово</b> — играем всей группой!\n\n"
             "Загадано одно слово. Пишите свои — игра покажет, насколько каждое близко по смыслу. "
             "Кто первым назовёт слово раунда, тот победил. Соревнуетесь только с участниками этой группы.\n\n"
             "Админам группы: /settings — длина раунда, пауза, словарь.")


def hook_secret(token=None):
    """the webhook's secret header, derived from the bot token (nothing more to keep in the env)"""
    return hashlib.sha256(("hook:" + (token or config.TG_APP_BOT_TOKEN)).encode()).hexdigest()[:48]


class TgBot:
    def __init__(self, manager):
        self.manager = manager
        self.username = config.TG_APP_BOT_USERNAME
        self.http = None

    # ------------------------------------------------------------------ Telegram Bot API
    async def api(self, method, **params):
        if not config.TG_APP_BOT_TOKEN:
            return None
        if self.http is None:
            import httpx
            self.http = httpx.AsyncClient(timeout=10)
        try:
            r = await self.http.post(f"https://api.telegram.org/bot{config.TG_APP_BOT_TOKEN}/{method}", json=params)
            d = r.json()
            if not d.get("ok"):
                print(f"[tg-bot] {method}: {d.get('description')}")
            return d.get("result") if d.get("ok") else None
        except Exception as e:
            print(f"[tg-bot] {method}: {type(e).__name__}")
            return None

    async def setup(self):
        """at start: the bot's name for the links, the webhook, the commands (retried until Telegram answers)"""
        if not config.TG_APP_BOT_TOKEN:
            return
        for attempt in range(10):
            me = await self.api("getMe")
            if me:
                self.username = me["username"]
                break
            await asyncio.sleep(min(60, 5 * (attempt + 1)))
        if config.TG_APP_PUBLIC_URL:
            await self.api("setWebhook", url=config.TG_APP_PUBLIC_URL + "/tg/hook", secret_token=hook_secret(),
                           allowed_updates=["message", "my_chat_member"], drop_pending_updates=False)
        await self.api("setMyCommands", scope={"type": "all_group_chats"}, language_code="",
                       commands=[{"command": "play", "description": "Играть"},
                                 {"command": "settings", "description": "Настройки игры (админам)"}])
        await self.api("setMyCommands", scope={"type": "default"},
                       commands=[{"command": "start", "description": "Играть"}])
        print(f"[tg-bot] @{self.username} ready")

    def play_url(self, code):
        return f"https://t.me/{self.username}?startapp=g{code}"

    def admin_url(self, code):
        return f"https://t.me/{self.username}?startapp=a{code}"

    async def is_admin(self, chat_id, user_id):
        m = await self.api("getChatMember", chat_id=chat_id, user_id=user_id)
        return bool(m and m.get("status") in ("creator", "administrator"))

    # ------------------------------------------------------------------ group rooms
    def group_room(self, code):
        room = self.manager.rooms.get(GROUP_PREFIX + code) if code else None
        return room if room and room.cfg.get("tg_code") == code else None

    def room_of_chat(self, chat_id):
        return next((r for r in self.manager.rooms.values() if r.cfg.get("tg_chat") == chat_id), None)

    def register(self, chat):
        """a group -> its room (made the first time; the code stays the same when the bot comes back)"""
        room = self.room_of_chat(chat["id"])
        if room is None:
            code = secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")
            room = new_tg_room(self.manager, GROUP_PREFIX + code)
            room.cfg.update(tg_code=code, tg_chat=chat["id"])
            print(f"[tg-bot] new group room {room.id}: {chat.get('title')!r}")
        room.cfg["tg_title"] = (chat.get("title") or "")[:80]
        room.cfg.pop("tg_left", None)
        self.manager.save()
        return room

    async def open_room(self, room):
        """a player comes: the room's games are loaded and running"""
        if not room.running:
            await self.manager.start(room.id)
            print(f"[tg-bot] room {room.id} up ({room.cfg.get('tg_title')!r})")
        room.tg_app.title = room.cfg.get("tg_title") or ""
        return room.tg_app

    async def reaper(self):
        """group rooms nobody played for TG_APP_UNLOAD_SEC: stopped and dropped from memory"""
        while True:
            await asyncio.sleep(30)
            await self.reap_once()

    async def reap_once(self, now=None):
        now = now or time.time()
        for rid, room in list(self.manager.rooms.items()):
            app = room.tg_app
            if not (room.cfg.get("tg_code") and room.running and app) or app.players:
                continue
            if app.empty_since and now - app.empty_since >= config.TG_APP_UNLOAD_SEC:
                try:
                    app.idle_check(max(now, app.empty_since + config.TG_APP_IDLE_SEC))   # paused first: the round
                    await self.manager.stop(rid)                                         # waits on disk
                    room.hub = room.tg_app = None
                    print(f"[tg-bot] room {rid} unloaded: nobody for {now - app.empty_since:.0f}s")
                except Exception as e:
                    print(f"[tg-bot] unload {rid}: {type(e).__name__}: {e}")

    # ------------------------------------------------------------------ a page's websocket
    async def gate(self, ws):
        """the page's first frame: who it is (initData) and which room (start_param) -> that room's session"""
        try:
            first = json.loads(await asyncio.wait_for(ws.receive_text(), 15))
        except Exception:
            await ws.close(code=4400)
            return
        first = first if isinstance(first, dict) else {}
        fields = init_data_fields(first.get("auth"), config.TG_APP_BOT_TOKEN)
        if not fields and config.TG_APP_DEV and first.get("dev"):           # local testing outside Telegram
            name = str(first["dev"])[:20]
            fields = {"user": {"id": int(hashlib.sha1(name.encode()).hexdigest()[:8], 16), "first_name": name},
                      "start_param": str(first.get("start") or "")}
        if not fields:
            from urllib.parse import parse_qsl
            keys = sorted(dict(parse_qsl(first.get("auth") or "")).keys())
            print(f"[tg-app] auth refused (initData fields: {keys or 'none'})")
            return await self.refuse(ws, "auth", 4401)
        start = fields.get("start_param") or ""
        kind, code = start[:1], start[1:]
        if kind in ("g", "a"):
            room = self.group_room(code)
            if room is None:
                return await self.refuse(ws, "no_room", 4404)
        else:
            room = self.manager.rooms.get(config.TG_APP_ROOM) if config.TG_APP_ROOM else None
            if room is None:
                return await self.refuse(ws, "no_room", 4404)
        is_admin = False
        if kind == "a":
            is_admin = (config.TG_APP_DEV and not first.get("auth")) or \
                await self.is_admin(room.cfg["tg_chat"], fields["user"]["id"])
            if not is_admin:
                return await self.refuse(ws, "not_admin", 4403)
        app = await self.open_room(room)
        await app.session(ws, fields["user"], is_admin)

    @staticmethod
    async def refuse(ws, reason, code):
        try:
            await ws.send_text(json.dumps({"type": "reject", "reason": reason}))
            await ws.close(code=code)
        except Exception:
            pass

    # ------------------------------------------------------------------ the bot's updates (webhook)
    async def on_update(self, u):
        if "my_chat_member" in u:
            m = u["my_chat_member"]
            chat, status = m["chat"], m["new_chat_member"]["status"]
            if chat.get("type") not in ("group", "supergroup"):
                return
            if status in ("member", "administrator"):
                room = self.register(chat)
                await self.send_play(chat["id"], room)
            elif status in ("left", "kicked"):
                room = self.room_of_chat(chat["id"])
                if room:
                    room.cfg["tg_left"] = int(time.time())  # its data stays: the bot may come back
                    self.manager.save()
            return
        msg = u.get("message") or {}
        chat = msg.get("chat") or {}
        if msg.get("migrate_to_chat_id"):                   # a group became a supergroup: a new chat id
            room = self.room_of_chat(chat.get("id"))
            if room:
                room.cfg["tg_chat"] = msg["migrate_to_chat_id"]
                self.manager.save()
            return
        text = (msg.get("text") or "").strip()
        if not text.startswith("/"):
            return
        cmd, _, to = text.split()[0][1:].partition("@")
        if to and to.lower() != (self.username or "").lower():
            return                                          # a command for another bot
        cmd = cmd.lower()
        if chat.get("type") == "private":
            if cmd in ("start", "play"):
                extra = {"reply_markup": {"inline_keyboard": [[{"text": "🎮 Играть", "web_app": {
                    "url": config.TG_APP_PUBLIC_URL + "/tg/"}}]]}} if config.TG_APP_PUBLIC_URL else {}
                await self.api("sendMessage", chat_id=chat["id"], parse_mode="HTML",
                               text="🎯 <b>Угадай слово</b>\n\nОбщая комната для всех. Добавьте бота в свою группу — "
                                    "и в ней будет своя игра, только для участников группы.", **extra)
            return
        if chat.get("type") not in ("group", "supergroup"):
            return
        room = self.room_of_chat(chat["id"]) or self.register(chat)
        if cmd in ("play", "start"):
            await self.send_play(chat["id"], room)
        elif cmd == "settings":
            uid = (msg.get("from") or {}).get("id")
            if uid and await self.is_admin(chat["id"], uid):
                await self.api("sendMessage", chat_id=chat["id"], reply_to_message_id=msg.get("message_id"),
                               text="⚙️ Настройки игры этой группы (откроются только у админов)",
                               reply_markup={"inline_keyboard": [[{"text": "⚙️ Открыть панель",
                                                                   "url": self.admin_url(room.cfg["tg_code"])}]]})
            else:
                await self.api("sendMessage", chat_id=chat["id"], reply_to_message_id=msg.get("message_id"),
                               text="Настройки игры доступны только админам группы.")

    async def send_play(self, chat_id, room):
        await self.api("sendMessage", chat_id=chat_id, parse_mode="HTML", text=PLAY_TEXT,
                       reply_markup={"inline_keyboard": [[{"text": "🎮 Играть", "url": self.play_url(room.cfg["tg_code"])}]]})


def new_tg_room(manager, rid):
    """a Mini App room with no streamer: Russian, short breaks, everyone may play"""
    room = manager.upsert(rid, {"tg_app": True, "lang": "ru"})
    hub = room.ensure_hub()
    hub.set_active("guess")
    hub.set_options("guess", {"pause": 10, "round_min": 10, "follow": 0})
    hub.save_session()
    if not room.running:
        room.hub = None                                   # on disk; loaded when the first player comes
    return room


__all__ = ["TgBot", "TgApp", "new_tg_room", "hook_secret", "GROUP_PREFIX"]
