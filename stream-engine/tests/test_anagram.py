"""Anagram: a tiny dictionary in a temp folder, no built assets needed.
    docker run --rm -v "$PWD:/app" -w /app python:3.12-slim sh -c "pip -q install numpy && python -m unittest tests.test_anagram -v"
"""

import os
import tempfile
import time
import unittest

from app import config
from app.games.anagram import game as ana
from app.games.anagram.game import AnagramGame, marks
from app.games.base import Viewer
from app.storage import JsonStore

ROUND = "представитель"
WORDS = [ROUND, "свет", "лист", "стрела", "редис", "деталь", "писатель", "ветер", "трасса", "партия", "тепло", "сталь"]


def v(name, follows=1):
    return Viewer(name.lower(), name, "", follows)


class AnagramTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        assets = os.path.join(cls.tmp, "assets")
        os.makedirs(os.path.join(assets, "ru"))
        with open(os.path.join(assets, "ru", "vocab.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(WORDS) + "\n")
        cls.assets_was, cls.lang_was, cls.cd_was = config.ASSETS_DIR, config.LANGUAGE, config.COUNTDOWN_SEC
        config.ASSETS_DIR, config.LANGUAGE, config.COUNTDOWN_SEC = assets, "ru", 0

    @classmethod
    def tearDownClass(cls):
        config.ASSETS_DIR, config.LANGUAGE, config.COUNTDOWN_SEC = cls.assets_was, cls.lang_was, cls.cd_was

    def make(self, store=None):
        g = AnagramGame(store or JsonStore(tempfile.mkdtemp(dir=self.tmp)))
        self.assertIsNone(g.error)
        g.tick(time.time())
        g.tick(time.time() + 0.01)
        self.assertEqual(g.phase, ana.PLAYING)
        self.assertEqual(g.word, ROUND)              # the only word of 11+ letters
        return g

    def tries(self, g):
        return [e for e in g.events if e["type"] == "try"]

    def test_marks(self):
        self.assertEqual(marks("трасса", ROUND), ["ok", "ok", "ok", "ok", "extra", "extra"])
        self.assertEqual(marks("партия", ROUND)[-1], "miss")

    def test_points_and_repeats(self):
        g = self.make()
        g.on_comment(v("Krestik"), "Свет")
        g.on_comment(v("Нина"), "деталь")
        self.assertEqual(g.players["krestik"]["score"], 4)
        g.on_comment(v("Сергей"), "свет")            # someone else's word: its author gets the points again
        g.on_comment(v("Tati"), "свет!")
        g.on_comment(v("Tati"), "свет")              # once per viewer
        self.assertEqual(g.players["krestik"]["score"], 12)
        self.assertNotIn("сергей", g.players)        # the repeater gets nothing
        self.assertEqual(g.found["свет"]["n"], 3)
        rows = g.snapshot()["players"]
        self.assertEqual([r["name"] for r in rows], ["Krestik", "Нина"])
        self.assertEqual(rows[0]["words"], [{"w": "СВЕТ", "n": 3, "last": "Tati", "lastT": g.found["свет"]["last_t"]}])
        kinds = [e["kind"] for e in self.tries(g)]
        self.assertEqual(kinds, ["ok", "ok", "rep", "rep"])

    def test_multiplier_stops_at_x3(self):
        g = self.make()
        for n in ("Krestik", "a", "b", "c", "d"):     # author, x2, x3, then +0.1 twice
            g.on_comment(v(n), "свет")
        self.assertEqual(g.players["krestik"]["score"], 12.2)
        self.assertEqual([e["points"] for e in self.tries(g)], [4, 4, 4, 0.1, 0.1])

    def test_rejected(self):
        g = self.make()
        g.on_comment(v("Нина"), "трасса")             # letters used up
        g.note_t = 0
        g.on_comment(v("фог"), "партия")             # no such letter
        g.note_t = 0
        g.on_comment(v("Valeria"), "тепрал")          # the right letters, not in the dictionary
        g.on_comment(v("Valeria"), "привет всем")    # chat
        g.on_comment(v("Valeria"), "да")              # too short
        self.assertEqual([e["kind"] for e in self.tries(g)], ["bad", "bad", "dict"])
        self.assertEqual(self.tries(g)[1]["marks"][-1], "miss")
        self.assertEqual(g.players, {})

    def test_own_word_again_counts_nothing(self):
        g = self.make()
        g.on_comment(v("Krestik"), "лист")
        g.on_comment(v("Krestik"), "лист")
        self.assertEqual(g.players["krestik"]["score"], 4)
        self.assertEqual(self.tries(g)[-1]["kind"], "own")

    def test_winner_and_champions(self):
        g = self.make()
        g.on_comment(v("Krestik"), "свет")
        g.on_comment(v("Нина"), "писатель")
        g.ends_at = time.time() - 1
        g.tick(time.time())
        self.assertEqual(g.phase, ana.WINNER)
        self.assertEqual(g.winner["name"], "Нина")
        self.assertEqual(g.winner["score"], 8)
        self.assertEqual(g.snapshot()["champions"][0]["players"][0]["name"], "Нина")
        self.assertEqual(g.history[-1]["podium"], ["Нина", "Krestik"])

    def test_nobody(self):
        g = self.make()
        g.ends_at = time.time() - 1
        g.tick(time.time())
        self.assertIsNone(g.winner)
        self.assertEqual([e["type"] for e in g.events][-1], "timeout")

    def test_follow_rule(self):
        g = self.make()
        g.set_option("follow", 1)
        g.on_comment(v("Noah", follows=0), "свет")
        self.assertEqual(g.players, {})
        self.assertEqual(g.events[-1]["type"], "follow_needed")

    def test_words_not_repeated_and_restored(self):
        store = JsonStore(tempfile.mkdtemp(dir=self.tmp))
        g = self.make(store)
        g.on_comment(v("Krestik"), "свет")
        g.save()
        g2 = AnagramGame(store)                        # an engine restart mid-round
        self.assertEqual((g2.phase, g2.word, g2.players["krestik"]["score"]), (ana.PLAYING, ROUND, 4))
        self.assertIn(ROUND, g2.used["ru"])           # the one long word is used: the next cycle starts anew
        g2.on_activate()
        g2.ends_at = time.time() - 1
        g2.tick(time.time())
        g2.set_option("pause", 0)
        g2.phase_until = 0
        g2.tick(time.time())
        g2.tick(time.time())
        self.assertEqual((g2.phase, g2.word, g2.round_id), (ana.COUNTDOWN, ROUND, 2))


class SwitchTest(unittest.TestCase):
    def test_guess_stands_still_while_anagram_plays(self):
        """Starting Anagram pauses a Guess the Word round: only the active game ticks; its monitor shows the pause
        with the timers stopped, and they go on from there when Guess the Word is back."""
        from app.games.guess import game as guess_mod
        from app.games.guess.game import GuessGame
        g = GuessGame(JsonStore(tempfile.mkdtemp()))
        now = time.time()
        g.phase, g.started_at, g.ends_at = guess_mod.PLAYING, now - 100, now + 500
        g.on_deactivate()
        g.paused_at -= 60                              # Anagram has been on for a minute
        c = g.monitor()["current"]
        self.assertTrue(c["away"] and c["paused"])
        self.assertAlmostEqual(c["left"], 560, delta=1)
        g.on_activate()
        self.assertAlmostEqual(g.ends_at - time.time(), 560, delta=1)
        self.assertFalse(g.monitor()["current"]["away"])


if __name__ == "__main__":
    unittest.main()
