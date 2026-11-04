"""Telegram Mini App (app/tg_app.py): the players' initData check and a word from a phone.
Runs without the real word assets: a tiny Russian dictionary with random vectors is made here."""

import hashlib
import hmac
import json
import os
import tempfile
import time
import unittest
from urllib.parse import urlencode

import numpy as np

from app import config
from app.games.guess import game as gmod
from app.hub import Hub
from app.storage import JsonStore
from app.tg_app import Player, TgApp, check_init_data, viewer_of

TOKEN = "123456:TEST-token"
WORDS = ["море", "океан", "волна", "пляж", "берег", "песок", "чайка", "залив", "лодка", "парус",
         "стол", "стул", "окно", "дверь", "книга", "лампа", "кошка", "собака", "дерево", "город"]


def signed(user, auth_date=None, token=TOKEN):
    """initData as Telegram makes it (newer clients add "signature", and the hash covers it too)"""
    pairs = {"query_id": "AAE", "user": json.dumps(user, ensure_ascii=False),
             "auth_date": str(int(auth_date or time.time())), "signature": "c2lnbmF0dXJl"}
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    pairs["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(pairs)


class InitDataTest(unittest.TestCase):
    def test_good(self):
        u = check_init_data(signed({"id": 42, "first_name": "Анна"}), TOKEN)
        self.assertEqual(u["id"], 42)

    def test_wrong_token_or_changed_data(self):
        data = signed({"id": 42, "first_name": "Анна"})
        self.assertIsNone(check_init_data(data, "999:other"))
        self.assertIsNone(check_init_data(data.replace("42", "43"), TOKEN))
        self.assertIsNone(check_init_data("", TOKEN))
        self.assertIsNone(check_init_data("garbage", TOKEN))

    def test_too_old(self):
        self.assertIsNone(check_init_data(signed({"id": 1}, auth_date=time.time() - 2 * 86400), TOKEN))

    def test_viewer(self):
        v = viewer_of({"id": 7, "first_name": "Иван", "last_name": "Петров", "photo_url": "https://t.me/i.jpg"})
        self.assertEqual((v.id, v.name, v.avatar), ("tg7", "Иван П", "https://t.me/i.jpg"))


class GuessFromPhoneTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = tempfile.mkdtemp()
        d = os.path.join(root, "ru")
        os.makedirs(d)
        with open(os.path.join(d, "vocab.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(WORDS))
        with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
            json.dump({"pools": {"easy": WORDS[:5], "medium": WORDS[5:10], "hard": []}, "level": "normal"}, f)
        np.save(os.path.join(d, "embeddings.npy"), np.random.RandomState(1).rand(len(WORDS), 8).astype(np.float32))
        cls.old = config.ASSETS_DIR, config.COUNTDOWN_SEC, config.TG_APP_WORD_SEC
        config.ASSETS_DIR, config.COUNTDOWN_SEC, config.TG_APP_WORD_SEC = root, 0, 1.2

    @classmethod
    def tearDownClass(cls):
        config.ASSETS_DIR, config.COUNTDOWN_SEC, config.TG_APP_WORD_SEC = cls.old

    def make(self):
        hub = Hub(JsonStore(tempfile.mkdtemp()), username="")
        hub.set_lang("ru")
        hub.set_active("guess")
        g = hub.games["guess"]
        self.assertIsNone(g.error, g.error)
        g.tick(time.time())
        g.tick(time.time() + 0.01)
        self.assertEqual(g.phase, gmod.PLAYING)
        return hub, g, TgApp(hub)

    def test_word_counts_and_answers_the_player(self):
        hub, g, app = self.make()
        p = Player(None, viewer_of({"id": 5, "first_name": "Оля"}))
        word = next(w for w in WORDS if w != g.secret)
        r = app.guess(p, word.upper())
        self.assertEqual(r["type"], "guess")
        self.assertEqual(r["rank"], int(g.rank[g.sem.index[word]]))
        self.assertEqual(r["place"], 1)
        self.assertIn([word.upper(), r["rank"]], r["words"])
        self.assertIn(word, g.players["tg5"].words)
        s = app.state()
        self.assertEqual(s["players"], 1)
        self.assertEqual([t["w"] for t in s["top"]], [word.upper()])
        self.assertEqual(app.mine("tg5")["words"], [[word.upper(), r["rank"]]])

    def test_rate_limit_and_bad_words(self):
        hub, g, app = self.make()
        p = Player(None, viewer_of({"id": 6, "first_name": "Петя"}))
        now = time.time()
        a, b = [w for w in WORDS if w != g.secret][:2]
        self.assertEqual(app.guess(p, a, now)["type"], "guess")
        self.assertEqual(app.guess(p, b, now + 0.5)["reason"], "slow")       # too fast: not counted
        self.assertNotIn(b, g.players["tg6"].words)
        self.assertEqual(app.guess(p, "абвгд", now + 2)["reason"], "unknown")
        self.assertEqual(app.guess(p, "два слова", now + 4)["reason"], "one")
        self.assertEqual(app.guess(p, b, now + 6)["type"], "guess")          # unknown words cost no wait

    def test_secret_wins(self):
        hub, g, app = self.make()
        p = Player(None, viewer_of({"id": 8, "first_name": "Макс"}))
        r = app.guess(p, g.secret)
        self.assertEqual(r["rank"], 1)
        self.assertEqual(g.phase, gmod.WINNER)
        self.assertEqual(app.state()["secret"].lower(), g.secret)
        self.assertEqual(app.guess(p, WORDS[0], time.time() + 5)["reason"], "wait")


class IdleTest(GuessFromPhoneTest):
    """nobody has the page open -> the game pauses; the first player back lifts only that pause"""
    test_word_counts_and_answers_the_player = test_rate_limit_and_bad_words = test_secret_wins = None

    def test_idle_pause_and_wake(self):
        hub, g, app = self.make()
        now = time.time()
        app.empty_since = now
        app.idle_check(now + config.TG_APP_IDLE_SEC - 1)
        self.assertIsNone(g.frozen)                                   # not yet
        app.idle_check(now + config.TG_APP_IDLE_SEC + 1)
        self.assertTrue(g.frozen and g.frozen["idle"])
        self.assertEqual(app.guess(Player(None, viewer_of({"id": 9})), WORDS[0], now + 300)["reason"], "wait")
        app.players["ws"] = object()
        app.wake(now + 400)
        self.assertIsNone(g.frozen)
        app.idle_check(now + 401)
        self.assertIsNone(app.empty_since)

    def test_host_pause_stays(self):
        hub, g, app = self.make()
        g.host_pause(time.time())                                     # the host paused it on the room page
        app.wake()
        self.assertIsNotNone(g.frozen)


if __name__ == "__main__":
    unittest.main()
