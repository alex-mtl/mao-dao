"""The Mini App's bot (app/tg_bot.py): a room per Telegram group, the gate, the admin panel, unloading."""

import asyncio
import json
import tempfile
import time
import unittest

from app import config
from app.rooms import RoomManager
from app.tg_bot import GROUP_PREFIX, TgBot, new_tg_room
from tests import test_tg_app as base             # the module, not its classes: they would run here again
from tests.test_tg_app import TOKEN, signed


class FakeWS:
    """a page's websocket: frames to receive, then the page goes away"""

    def __init__(self, *frames):
        self.inbox = [json.dumps(f) for f in frames]
        self.sent, self.closed = [], None

    async def receive_text(self):
        await asyncio.sleep(0)
        if self.inbox:
            return self.inbox.pop(0)
        raise ConnectionError("gone")

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def close(self, code=1000):
        self.closed = code

    def of(self, kind):
        return [m for m in self.sent if m.get("type") == kind]


class Bot(TgBot):
    """no Telegram: calls are recorded, admins are a set"""

    def __init__(self, manager, admins=()):
        super().__init__(manager)
        self.username, self.calls, self.admins = "test_bot", [], set(admins)

    async def api(self, method, **params):
        self.calls.append((method, params))
        return {"ok": True}

    async def is_admin(self, chat_id, user_id):
        return user_id in self.admins


class GroupRoomsTest(base.GuessFromPhoneTest):
    test_word_counts_and_answers_the_player = test_rate_limit_and_bad_words = test_secret_wins = None

    def setUp(self):
        self.old_tg = config.TG_APP_BOT_TOKEN, config.TG_APP_ROOM, config.TG_APP_DEV
        config.TG_APP_BOT_TOKEN, config.TG_APP_ROOM, config.TG_APP_DEV = TOKEN, "tgapp", False
        self.manager = RoomManager(tempfile.mkdtemp())
        new_tg_room(self.manager, "tgapp")

    def tearDown(self):
        config.TG_APP_BOT_TOKEN, config.TG_APP_ROOM, config.TG_APP_DEV = self.old_tg

    def run_async(self, coro):
        async def go():
            try:
                return await coro
            finally:
                await self.manager.stop_all()
        return asyncio.run(go())

    def added(self, bot, chat_id=-100, title="Друзья"):
        return bot.on_update({"my_chat_member": {"chat": {"id": chat_id, "type": "supergroup", "title": title},
                                                 "new_chat_member": {"status": "member"}}})

    def test_bot_added_to_a_group_makes_its_room_and_posts_the_button(self):
        bot = Bot(self.manager)

        async def go():
            await self.added(bot)
            await self.added(bot)                                   # added again: the same room
        self.run_async(go())
        rooms = [r for r in self.manager.rooms.values() if r.cfg.get("tg_chat") == -100]
        self.assertEqual(len(rooms), 1)
        room = rooms[0]
        self.assertTrue(room.id.startswith(GROUP_PREFIX))
        self.assertEqual(room.cfg["tg_title"], "Друзья")
        self.assertIsNone(room.hub)                                 # not loaded until somebody plays
        method, params = bot.calls[-1]
        self.assertEqual(method, "sendMessage")
        url = params["reply_markup"]["inline_keyboard"][0][0]["url"]
        self.assertEqual(url, f"https://t.me/test_bot?startapp=g{room.cfg['tg_code']}")

    def test_players_of_a_group_play_in_its_room_only(self):
        bot = Bot(self.manager)

        async def go():
            await self.added(bot, -1, "А")
            await self.added(bot, -2, "Б")
            a, b = (bot.room_of_chat(i) for i in (-1, -2))
            ws1 = FakeWS({"auth": signed({"id": 1, "first_name": "Оля"}, start=f"g{a.cfg['tg_code']}")})
            ws2 = FakeWS({"auth": signed({"id": 2, "first_name": "Петя"})})      # no code: the common room
            ws3 = FakeWS({"auth": signed({"id": 3, "first_name": "Вор"}, start="gnosuchcode")})
            for ws in (ws1, ws2, ws3):
                await bot.gate(ws)
            return a, b, ws1, ws2, ws3
        a, b, ws1, ws2, ws3 = self.run_async(go())
        self.assertEqual(ws1.of("hello")[0]["title"], "А")
        self.assertEqual(ws2.of("hello")[0]["title"], "")
        self.assertEqual((ws3.closed, ws3.of("reject")[0]["reason"]), (4404, "no_room"))
        self.assertIsNone(b.hub)                                    # nobody came to group Б

    def test_admin_panel_only_for_admins(self):
        bot = Bot(self.manager, admins={7})

        async def go():
            await self.added(bot)
            code = bot.room_of_chat(-100).cfg["tg_code"]
            stranger = FakeWS({"auth": signed({"id": 8, "first_name": "Не админ"}, start=f"a{code}")})
            admin = FakeWS({"auth": signed({"id": 7, "first_name": "Админ"}, start=f"a{code}")},
                           {"admin": {"set": {"round_min": 20}}}, {"admin": {"cmd": "pause"}},
                           {"admin": {"set": {"round_min": 999}}})
            player = FakeWS({"auth": signed({"id": 9, "first_name": "Игрок"}, start=f"g{code}")},
                            {"admin": {"cmd": "skip"}})                   # a player can't send admin commands
            for ws in (stranger, admin, player):
                await bot.gate(ws)
            return stranger, admin, player, bot.room_of_chat(-100)
        stranger, admin, player, room = self.run_async(go())
        self.assertEqual((stranger.closed, stranger.of("reject")[0]["reason"]), (4403, "not_admin"))
        panels = admin.of("admin")
        self.assertEqual(panels[1]["done"], "set")
        self.assertEqual(panels[1]["options"]["round_min"]["value"], 20)
        self.assertEqual(panels[2]["done"], "pause")
        self.assertTrue(panels[2]["paused"])
        self.assertIsNone(panels[3]["done"])                         # not one of the choices
        self.assertFalse(player.of("admin"))
        self.assertTrue(room.hub.games["guess"].frozen)              # the admin's pause: players don't lift it

    def test_settings_command_answers_admins_with_the_panel_link(self):
        bot = Bot(self.manager, admins={7})

        async def go():
            await self.added(bot)
            for uid in (7, 8):
                await bot.on_update({"message": {"message_id": 1, "text": "/settings@test_bot", "from": {"id": uid},
                                                 "chat": {"id": -100, "type": "supergroup", "title": "Друзья"}}})
            await bot.on_update({"message": {"message_id": 2, "text": "/settings@other_bot", "from": {"id": 7},
                                             "chat": {"id": -100, "type": "supergroup"}}})
        self.run_async(go())
        code = bot.room_of_chat(-100).cfg["tg_code"]
        sends = [p for m, p in bot.calls if m == "sendMessage"]
        self.assertEqual(len(sends), 3)                              # welcome, admin's link, refusal; other bot: none
        self.assertEqual(sends[1]["reply_markup"]["inline_keyboard"][0][0]["url"], f"https://t.me/test_bot?startapp=a{code}")
        self.assertNotIn("reply_markup", sends[2])

    def test_empty_group_room_is_unloaded_and_comes_back(self):
        bot = Bot(self.manager)
        old = config.TG_APP_UNLOAD_SEC
        config.TG_APP_UNLOAD_SEC = 0

        async def go():
            await self.added(bot)
            room = bot.room_of_chat(-100)
            code = room.cfg["tg_code"]
            await bot.gate(FakeWS({"auth": signed({"id": 1, "first_name": "Оля"}, start=f"g{code}")}))
            self.assertTrue(room.running)
            round_id = room.hub.games["guess"].round_id
            room.tg_app.empty_since = time.time() - 1                # the player has left
            await bot.reap_once()
            self.assertFalse(room.running)
            self.assertIsNone(room.hub)
            ws = FakeWS({"auth": signed({"id": 1, "first_name": "Оля"}, start=f"g{code}")})
            await bot.gate(ws)                                       # comes back from disk
            self.assertTrue(room.running)
            return round_id, room, ws
        try:
            round_id, room, ws = self.run_async(go())
        finally:
            config.TG_APP_UNLOAD_SEC = old
        self.assertEqual(ws.of("state")[0]["roundId"], round_id)     # the same round goes on
        self.assertIsNone(room.hub.games["guess"].frozen)            # the idle pause was lifted


if __name__ == "__main__":
    unittest.main()
