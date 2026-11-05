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


class TinyAssets(unittest.TestCase):
    """A dictionary of WORDS in a temp folder as the engine's assets, for the test class."""

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


class AnagramTest(TinyAssets):
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
        g.on_comment(v("Нина"), "лист")
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

    def test_without_multiplication_every_repeat_is_a_tenth(self):
        g = self.make()
        g.set_option("mult", 0)
        for n in ("Krestik", "a", "b", "c", "d"):
            g.on_comment(v(n), "свет")
        g.on_comment(v("Krestik"), "свет")           # the author again: nothing
        self.assertEqual(g.players["krestik"]["score"], 4.4)
        self.assertEqual(g.found["свет"]["n"], 5)     # the overlay shows the real count, x5
        self.assertFalse(g.snapshot()["mult"])

    def test_round_word_itself_counts_nothing(self):
        g = self.make()
        g.on_comment(v("Нина"), ROUND)
        self.assertEqual(g.players, {})
        self.assertEqual(self.tries(g)[-1]["kind"], "base")
        self.assertNotIn(ROUND, g.possible)

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
        self.assertEqual(g.winner["score"], 16)        # the first word of 8 letters: x2
        self.assertEqual(g.snapshot()["champions"][0]["players"][0]["name"], "Нина")
        self.assertEqual(g.history[-1]["podium"], ["Нина", "Krestik"])

    def end(self, g):
        g.ends_at = time.time() - 1
        g.tick(time.time())

    def test_longest_word_yet_scores_double(self):
        g = self.make()
        g.on_comment(v("Krestik"), "свет")             # 4 letters: never doubled
        g.on_comment(v("Нина"), "редис")               # the longest yet, 5 letters: x2
        g.on_comment(v("Tati"), "ветер")               # 5 again: as usual
        g.on_comment(v("Tati"), "писатель")            # 8: x2
        g.on_comment(v("Нина"), "деталь")              # 6 after an 8: too late, as usual
        g.on_comment(v("Krestik"), "редис")            # a repeat of a doubled word: its letters once more
        self.assertEqual([(e["points"], e.get("first")) for e in self.tries(g)],
                         [(4, False), (10, True), (5, False), (16, True), (6, False), (5, None)])
        self.assertEqual((g.players["нина"]["score"], g.players["tati"]["score"]), (21, 21))

    def test_most_repeated_word_bonus(self):
        g = self.make()
        g.on_comment(v("Krestik"), "свет")
        g.on_comment(v("Нина"), "лист")
        for n in ("a", "b"):
            g.on_comment(v(n), "свет")                 # x3
        g.on_comment(v("c"), "лист")                   # x2
        self.end(g)
        self.assertEqual(g.phase, ana.BONUS)           # the overlay's animation first, the scores not yet counted
        self.assertEqual(g.players["krestik"]["score"], 12)
        e = [x for x in g.events if x["type"] == "bonus"][-1]
        self.assertEqual(([i["word"] for i in e["items"]], e["items"][0]["n"], e["combo"]), (["СВЕТ"], 3, False))
        self.assertEqual(g.snapshot()["bonus"]["items"][0]["uid"], "krestik")
        g.tick(g.phase_until + 0.1)
        self.assertEqual(g.phase, ana.WINNER)
        self.assertEqual((g.players["krestik"]["score"], g.winner["score"]), (15, 15))
        self.assertEqual(g.history[-1]["bonus"], [["СВЕТ", "Krestik", 3]])

    def test_bonus_ties_up_to_three_words(self):
        g = self.make()
        for who, w in (("Krestik", "свет"), ("Нина", "лист"), ("Tati", "сталь")):
            g.on_comment(v(who), w)
            g.on_comment(v("x"), w)                    # each named twice
        self.end(g)
        self.assertEqual(g.bonus["points"], {"krestik": 2, "нина": 2, "tati": 2})
        g.tick(g.phase_until + 0.1)
        self.assertEqual(g.players["tati"]["score"], 10 + 5 + 2)

    def test_bonus_three_words_of_one_player_doubled(self):
        g = self.make()
        for w in ("свет", "лист", "стрела"):
            g.on_comment(v("Krestik"), w)
            g.on_comment(v("x"), w)
        self.end(g)
        self.assertTrue(g.bonus["combo"])
        self.assertEqual(g.bonus["points"], {"krestik": 12})   # (2 + 2 + 2) x2
        g.tick(g.phase_until + 0.1)
        self.assertEqual(g.players["krestik"]["score"], 4 + 4 + 4 + 4 + 12 + 6 + 12)

    def test_no_bonus_for_more_than_three_or_no_repeats(self):
        g = self.make()
        for who, w in (("a", "свет"), ("b", "лист"), ("c", "сталь"), ("d", "ветер")):
            g.on_comment(v(who), w)
            g.on_comment(v("x"), w)
        self.end(g)
        self.assertEqual((g.phase, g.bonus), (ana.WINNER, None))
        g2 = self.make()
        g2.on_comment(v("a"), "свет")
        self.end(g2)
        self.assertEqual(g2.phase, ana.WINNER)

    def test_nobody(self):
        g = self.make()
        g.ends_at = time.time() - 1
        g.tick(time.time())
        self.assertIsNone(g.winner)
        self.assertEqual([e["type"] for e in g.events][-1], "timeout")

    def test_host_pause(self):
        g = self.make()
        left = g.ends_at - time.time()
        self.assertTrue(g.control("pause", {}))
        self.assertFalse(g.control("pause", {}))
        g.on_comment(v("Ann"), "свет")             # no answers while paused
        self.assertFalse(g.found)
        g.frozen_at -= 100                           # 100 s on pause: the round's time stands still
        g.tick(time.time() + 10_000)
        self.assertEqual(g.phase, ana.PLAYING)
        s = g.snapshot()
        self.assertTrue(s["hostPaused"])
        self.assertTrue(g.monitor()["current"]["paused"])
        self.assertFalse(g.control("finish", {}))
        self.assertTrue(g.control("resume", {}))
        self.assertAlmostEqual(g.ends_at - time.time(), left + 100, delta=2)
        g.on_comment(v("Ann"), "свет")
        self.assertIn("свет", g.found)
        self.assertTrue(g.control("finish", {}))
        self.assertNotEqual(g.phase, ana.PLAYING)

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


class SharedFrameTest(TinyAssets):
    def test_frame_is_the_rooms(self):
        """The frame format / chroma key / chat zone set in one game go to every game; a room that had Anagram with
        a frame of its own takes Guess the Word's once."""
        from app.hub import Hub
        d = tempfile.mkdtemp(dir=self.tmp)
        JsonStore(d).save("session.json", {"options": {"guess": {"frame": 20, "chat_zone": 15},
                                                       "anagram": {"frame": 16, "chat_zone": 20}}})
        hub = Hub(JsonStore(d))
        self.assertEqual((hub.games["anagram"].frame, hub.games["anagram"].chat_zone), (20, 15))
        hub.set_options("anagram", {"frame": 19.5})
        self.assertEqual((hub.games["guess"].frame, hub.games["streamer"].frame), (19.5, 19.5))
        hub.save_session()
        hub.set_options("guess", {"frame": 16})
        hub2 = Hub(JsonStore(d))                       # migrated once: a later start keeps what was set
        self.assertEqual(hub2.games["anagram"].frame, 16)


class WebVersionTest(unittest.TestCase):
    def test_page_files_deployed_alone_reach_open_overlays(self):
        """A deploy of page files with no engine restart changes the version the overlays get (they reload)."""
        from app import server
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "a.js"), "w") as f:
            f.write("1")
        web, server.WEB = server.WEB, d
        try:
            server._version["t"] = 0
            v1 = server.web_version()
            with open(os.path.join(d, "a.js"), "w") as f:
                f.write("22")
            self.assertEqual(server.web_version(), v1)      # re-read at most every VERSION_SEC
            server._version["t"] = 0
            self.assertNotEqual(server.web_version(), v1)
        finally:
            server.WEB = web
            server._version["t"] = 0


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
