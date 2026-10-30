"""The LIVE log (one JSONL per LIVE) and the avatar cache: what the clip / digest pipeline reads."""

import json
import os
import tempfile
import time
import unittest

import numpy as np
from fastapi.testclient import TestClient

from app import config, live_log
from app.games.base import Viewer
from app.games.guess import game as guess_mod
from app.hub import Hub
from app.rooms import RoomManager
from app.server import create_app
from app.storage import JsonStore

WORDS = ["ocean", "water", "river", "stone", "cloud", "apple", "table", "music"]


def tiny_assets():
    """a dictionary of 8 words for every language and level (the real ones aren't in the repo)"""
    root = tempfile.mkdtemp()
    emb = np.random.default_rng(1).normal(size=(len(WORDS), 8)).astype(np.float32)
    for key in ("en", "en-easy", "ru", "ru-easy", "ru-hard", "fr", "es"):
        d = os.path.join(root, key)
        os.makedirs(d)
        with open(os.path.join(d, "vocab.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(WORDS))
        with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
            json.dump({"pools": {"easy": WORDS, "medium": WORDS, "hard": WORDS}}, f)
        np.save(os.path.join(d, "embeddings.npy"), emb)
    return root


def lines(hub):
    with open(hub.live.path, encoding="utf-8") as f:
        return [json.loads(x) for x in f]


class FakeAvatars(live_log.AvatarCache):
    def fetch(self, key, url):
        with open(os.path.join(self.folder, f"{key}.jpg"), "wb") as f:
            f.write(b"\xff\xd8" + url.encode())


class LiveLogTest(unittest.TestCase):
    def setUp(self):
        self.saved = config.ASSETS_DIR, config.COUNTDOWN_SEC, config.INTERNAL_SECRET, live_log._avatars
        config.ASSETS_DIR, config.COUNTDOWN_SEC, config.INTERNAL_SECRET = tiny_assets(), 0, "s3cret"
        self.dir = tempfile.mkdtemp()
        live_log._avatars = FakeAvatars(os.path.join(self.dir, "avatars"))

    def tearDown(self):
        config.ASSETS_DIR, config.COUNTDOWN_SEC, config.INTERNAL_SECRET, live_log._avatars = self.saved

    def hub(self, folder="room"):
        return Hub(JsonStore(os.path.join(self.dir, "rooms", folder)), username="host")

    def test_nothing_is_written_before_a_live(self):
        h = self.hub()
        h.like(Viewer("anna", "Anna", "https://x/a.jpg", 1, 0, "111"), 5)
        self.assertIsNone(h.live.path)

    def test_a_live_round_by_round(self):
        h = self.hub()
        h.set_active("guess")
        h.new_live("7001")
        anna = Viewer("anna", "Anna", "https://p16/anna.webp", 1, 0, "111")
        h.join(anna)
        h.join(anna)                                          # seen already: one "viewer" line
        anna = Viewer("anna", "Anna ✨", "https://p16/anna.webp", 1, 0, "111")
        h.join(anna)                                          # renamed: a new line
        g = h.game
        self.assertIsNone(g.error, g.error)
        g.tick(time.time())
        g.tick(time.time() + 0.01)
        self.assertEqual(g.phase, guess_mod.PLAYING)
        h.comment(anna, g.secret)                             # found the word
        h.like(Viewer("bob", "Bob", "", 1, 0, "222"), config.PLANE_AUTO_LIKES)
        h.gift(Viewer("carl", "Carl", "", 1, 0, "333"), "Rose", 1, coins=1)        # small: not in the log
        h.gift(Viewer("carl", "Carl", "", 1, 0, "333"), "Lion", 1, coins=29999)
        out = lines(h)
        kinds = [x["type"] for x in out]
        self.assertEqual(kinds[0], "live_start")
        self.assertEqual(out[0]["tiktok_room"], "7001")
        self.assertEqual([x["user"]["name"] for x in out if x["type"] == "viewer" and x["user"]["id"] == "anna"],
                         ["Anna", "Anna ✨"])
        start = next(x for x in out if x["type"] == "round_start")
        self.assertEqual((start["round"], start["word"]), (1, g.secret))
        win = next(x for x in out if x["type"] == "winner")
        self.assertEqual(win["user"], {"uid": "111", "id": "anna", "name": "Anna ✨"})
        end = next(x for x in out if x["type"] == "round_end")
        self.assertEqual((end["reason"], end["winner"]["uid"], end["word"]), ("exact", "111", g.secret))
        plane = next(x for x in out if x["type"] == "plane")
        self.assertEqual((plane["user"]["uid"], plane["likes"], plane["threshold"]),
                         ("222", config.PLANE_AUTO_LIKES, config.PLANE_AUTO_LIKES))
        self.assertIn("balloon", kinds)
        gifts = [x for x in out if x["type"] == "gift"]
        self.assertEqual([x["gift"] for x in gifts], ["Lion"])
        for x in out:
            self.assertIsInstance(x["s"], (int, float))
            self.assertIn("T", x["t"])

        # the next round ends with nobody: round_end with no winner
        t = time.time()
        for _ in range(20):
            if g.phase == guess_mod.PLAYING:
                break
            t += 1000
            g.tick(t)
        self.assertEqual((g.phase, g.round_id), (guess_mod.PLAYING, 2))
        g._finish(t, "timeout")
        ends = [x for x in lines(h) if x["type"] == "round_end"]
        self.assertEqual((ends[-1]["round"], ends[-1]["reason"], ends[-1].get("winner")), (2, "timeout", None))

    def test_same_live_after_a_restart_goes_on_in_its_file(self):
        h = self.hub()
        h.new_live("7002")
        first = h.live.path
        h2 = self.hub()                                      # the engine restarted, TikTok connects again
        h2.new_live("7002")
        self.assertEqual(h2.live.path, first)
        self.assertEqual(h2.live.started, h.live.started)
        h2.new_live("7003")                                  # a new LIVE: a new file
        self.assertNotEqual(h2.live.path, first)

    def test_avatars_saved_by_numeric_id(self):
        h = self.hub()
        h.new_live("7004")
        h.join(Viewer("anna", "Anna", "https://p16/anna.webp", 1, 0, "111"))
        h.join(Viewer("nouid", "No Uid", "https://p16/n.webp", 1, 0, ""))
        h.join(Viewer("plain", "Plain", "http://not-https/p.webp", 1, 0, "999"))
        cache = live_log._avatars
        deadline = time.time() + 3
        while (cache.pending or not cache.jobs.empty()) and time.time() < deadline:
            time.sleep(0.02)
        self.assertTrue(cache.find("111").endswith("111.jpg"))
        self.assertTrue(cache.find("nouid"))
        self.assertIsNone(cache.find("999"))                 # only https links are fetched

    def test_internal_api(self):
        manager = RoomManager(self.dir)
        live_log._avatars = FakeAvatars(os.path.join(self.dir, "avatars"))
        with TestClient(create_app(manager)) as c:
            sec = {"X-Internal-Secret": "s3cret"}
            c.put("/internal/rooms/a", headers=sec, json={"simulate": True})
            h = manager.rooms["a"].ensure_hub()
            h.new_live("7005")
            h.join(Viewer("anna", "Anna", "https://p16/anna.webp", 1, 0, "111"))
            self.assertEqual(c.get("/internal/lives").status_code, 403)
            lives = c.get("/internal/lives", headers=sec).json()["lives"]
            self.assertEqual([(x["room"], x["file"]) for x in lives], [("a", os.path.basename(h.live.path))])
            r = c.get(f"/internal/lives/a/{lives[0]['file']}", headers=sec)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(json.loads(r.text.splitlines()[0])["type"], "live_start")
            self.assertEqual(c.get("/internal/lives/a/..%2Frooms.json", headers=sec).status_code, 404)
            self.assertEqual(c.get("/internal/lives/b/x.jsonl", headers=sec).status_code, 404)
            deadline = time.time() + 3
            while not live_log._avatars.find("111") and time.time() < deadline:
                time.sleep(0.02)
            self.assertEqual(c.get("/internal/avatars/111", headers=sec).status_code, 200)
            self.assertEqual(c.get("/internal/avatars/nobody", headers=sec).status_code, 404)


if __name__ == "__main__":
    unittest.main()
