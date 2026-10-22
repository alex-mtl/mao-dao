"""Many rooms in one process: the platform's internal API, tokens, isolation, restore after a restart."""

import asyncio
import tempfile
import unittest

from fastapi.testclient import TestClient

from app import config
from app.rooms import RoomManager
from app.server import create_app

SECRET = {"X-Internal-Secret": "s3cret"}


class RoomsTest(unittest.TestCase):
    def setUp(self):
        self.saved = config.INTERNAL_SECRET, config.BASE_PATH
        config.INTERNAL_SECRET, config.BASE_PATH = "s3cret", "/guessword/engine"
        self.dir = tempfile.mkdtemp()
        self.manager = RoomManager(self.dir)

    def tearDown(self):
        config.INTERNAL_SECRET, config.BASE_PATH = self.saved

    def test_two_rooms_side_by_side(self):
        with TestClient(create_app(self.manager)) as c:
            self.assertEqual(c.get("/internal/rooms").status_code, 403)               # no secret
            self.assertEqual(c.get("/internal/rooms", headers={"X-Internal-Secret": "x"}).status_code, 403)
            a = c.put("/internal/rooms/a", headers=SECRET, json={"simulate": True, "lang": "ru"}).json()
            b = c.put("/internal/rooms/b", headers=SECRET, json={"simulate": True, "username": "@Other"}).json()
            self.assertNotEqual(a["overlay_token"], b["overlay_token"])
            self.assertTrue(a["overlay_url"].startswith(f"/guessword/engine/r/{a['overlay_token']}/guess/"))
            self.assertEqual(c.post("/internal/rooms/a/start", headers=SECRET).json()["running"], True)
            c.post("/internal/rooms/b/start", headers=SECRET)
            ca, oa, cb = a["control_token"], a["overlay_token"], b["control_token"]

            menu = c.get(f"/r/{ca}/")                                    # the menu: control token only
            self.assertEqual(menu.status_code, 200)
            self.assertIn(f'<base href="/guessword/engine/r/{ca}/">', menu.text)
            self.assertEqual(c.get(f"/r/{oa}/").status_code, 404)
            self.assertEqual(c.get(f"/r/{oa}/debug/").status_code, 404)
            page = c.get(f"/r/{oa}/guess/?tt=1")                        # the Studio page: overlay token
            self.assertEqual(page.status_code, 200)
            self.assertIn(f'<base href="/guessword/engine/r/{oa}/">', page.text)
            self.assertEqual(c.get(f"/r/{oa}/common/live.js").status_code, 200)
            r = c.get(f"/r/{oa}/guess?tt=1&alpha=1", follow_redirects=False)    # no slash: the mode survives
            self.assertEqual(r.headers["location"], f"/guessword/engine/r/{oa}/guess/?tt=1&alpha=1")
            self.assertEqual(c.get(f"/r/{oa}/../../app/config.py").status_code, 404)    # no way out of web/
            self.assertEqual(c.post(f"/r/{oa}/api/settings", json={"lang": "en"}).status_code, 404)
            self.assertEqual(c.get("/r/nope/guess/").status_code, 404)

            # each room its own game, settings and feed
            c.post(f"/r/{ca}/api/active", json={"game": "guess"})
            c.post(f"/r/{ca}/api/settings", json={"game": "global", "options": {"balloon_likes": 500}})
            c.post(f"/r/{ca}/api/debug/chat", json={"name": "Vasya", "text": "привет"})
            sa, sb = c.get(f"/r/{oa}/api/state?fsince=0").json(), c.get(f"/r/{cb}/api/state?fsince=0").json()
            self.assertEqual((sa["lang"], sa["active"]), ("ru", "guess"))
            self.assertEqual(sa["balloons"]["perBalloon"], 500)
            self.assertNotEqual(sb["balloons"]["perBalloon"], 500)
            self.assertTrue(any(e.get("name") == "Vasya" for e in sa["feed"]))
            self.assertFalse(any(e.get("name") == "Vasya" for e in sb["feed"]))
            self.assertEqual(self.manager.rooms["b"].hub.username, "other")

            with c.websocket_connect(f"/r/{oa}/ws") as ws:                 # the overlay's live updates
                self.assertEqual(ws.receive_json()["active"], "guess")

            opts = c.get("/internal/rooms/a/options", headers=SECRET).json()
            self.assertIn("guess", [g["name"] for g in opts["games"]])
            c.post("/internal/rooms/a/settings", headers=SECRET, json={"lang": "en"})
            self.assertEqual(c.get(f"/r/{oa}/api/state").json()["lang"], "en")
            self.assertEqual(c.post("/internal/rooms/b/stop", headers=SECRET).json()["running"], False)
            self.assertEqual(c.get("/health").json()["running"], 1)
            c.delete("/internal/rooms/b", headers=SECRET)
            self.assertEqual(c.get(f"/r/{cb}/api/state").status_code, 404)

    def test_restore_after_restart(self):
        async def first():
            m = RoomManager(self.dir)
            m.upsert("a", {"simulate": True})
            m.upsert("b", {"simulate": True})
            await m.start("a")
            await m.stop_all()                         # the process stops: "a" was running

        async def second():
            m = RoomManager(self.dir)
            m.restore()
            running = {rid for rid, r in m.rooms.items() if r.running}
            await m.stop_all()
            return running

        asyncio.run(first())
        self.assertEqual(asyncio.run(second()), {"a"})

    def test_stopped_connector_does_not_reconnect(self):
        """TikTokLive turns a cancel into its own RuntimeError; after the room's stop that must end the loop"""
        from app.tiktok.client import TikTokConnector

        class Hub:
            tiktok_status = "connected"
        c = TikTokConnector(Hub(), "x")
        calls = []

        async def run_once():
            calls.append(1)
            c.stopping = True                         # the room is being stopped meanwhile
            raise RuntimeError("This event loop is already running")
        c._run_once = run_once
        asyncio.run(asyncio.wait_for(c.run_forever(), 2))
        self.assertEqual(calls, [1])

    def test_room_stops_itself_without_a_live(self):
        from app.tiktok.client import TikTokConnector
        from TikTokLive.client.errors import UserOfflineError

        async def run():
            saved = config.LIVE_WAIT_SEC, config.RECONNECT_SEC
            config.LIVE_WAIT_SEC, config.RECONNECT_SEC = 0.3, 0.05
            try:
                m = RoomManager(self.dir)
                m.upsert("a", {"username": "nobody"})

                async def offline(self_):
                    raise UserOfflineError("not live")
                real = TikTokConnector._run_once
                TikTokConnector._run_once = offline
                try:
                    await m.start("a")
                    for _ in range(40):
                        await asyncio.sleep(0.05)
                        if not m.rooms["a"].running:
                            break
                finally:
                    TikTokConnector._run_once = real
                return m.rooms["a"].running, m.rooms["a"].status()["stop_reason"], m._load()["a"]["running"]
            finally:
                config.LIVE_WAIT_SEC, config.RECONNECT_SEC = saved

        self.assertEqual(asyncio.run(run()), (False, "no_live", False))

    def test_euler_key_per_room(self):
        from app.tiktok.client import TikTokConnector
        self.assertEqual(TikTokConnector(None, "x", "k1").sign_api_key, "k1")
        self.assertIsNone(TikTokConnector(None, "x").sign_api_key)


if __name__ == "__main__":
    unittest.main()


class RoomPrefsApiTest(unittest.TestCase):
    """The room page applies toast and gift settings through the room's settings API."""

    def setUp(self):
        self.saved = config.INTERNAL_SECRET, config.BASE_PATH
        config.INTERNAL_SECRET, config.BASE_PATH = "s3cret", "/guessword/engine"
        self.manager = RoomManager(tempfile.mkdtemp())

    def tearDown(self):
        config.INTERNAL_SECRET, config.BASE_PATH = self.saved

    def test_toasts_and_gifts_through_the_api(self):
        with TestClient(create_app(self.manager)) as c:
            a = c.put("/internal/rooms/a", headers=SECRET, json={"simulate": True}).json()
            ctl, ov = a["control_token"], a["overlay_token"]
            c.post(f"/r/{ctl}/api/settings", json={"game": "toasts", "options": {"hint": {"voice": 0}}})
            c.post(f"/r/{ctl}/api/settings", json={"game": "gifts", "options": {"plane": "gift:Rose"}})
            info = c.get(f"/r/{ctl}/api/games").json()
            self.assertEqual(info["toasts"]["values"], {"hint": {"voice": 0}})
            self.assertEqual(info["gifts"]["values"]["plane"], "gift:Rose")
            self.assertTrue(any(g["name"] == "Rose" for g in info["gifts"]["catalog"]))
            self.assertEqual(c.get(f"/r/{ov}/api/state").json()["toasts"], {"hint": {"voice": 0}})   # pages get them
