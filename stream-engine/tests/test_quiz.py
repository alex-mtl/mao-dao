"""Quiz: the built-in sample questions (no platform), timers driven by tick(now).
    docker run --rm -v "$PWD:/app" -w /app python:3.12-slim sh -c "pip -q install numpy && python -m unittest tests.test_quiz -v"
"""

import tempfile
import time
import unittest

from app import config
from app.games.base import Viewer
from app.games.quiz import game as qz
from app.games.quiz.game import QuizGame, norm
from app.storage import JsonStore


def v(name, follows=1):
    return Viewer(name.lower(), name, "", follows)


class QuizTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.was = config.PLATFORM_URL, config.DATA_DIR, config.LANGUAGE
        config.PLATFORM_URL, config.DATA_DIR, config.LANGUAGE = "", cls.tmp, "ru"

    @classmethod
    def tearDownClass(cls):
        config.PLATFORM_URL, config.DATA_DIR, config.LANGUAGE = cls.was

    def make(self, store=None, topics="geography"):
        g = QuizGame(store or JsonStore(tempfile.mkdtemp(dir=self.tmp)))
        g.set_option("topics", topics)
        self.t = time.time()
        g.tick(self.t)
        self.assertEqual(g.phase, qz.TOPIC)
        self.assertEqual(g.topic, "geography")
        self.assertEqual(len(g.questions), 5)
        g.tick(self.t + qz.TOPIC_SEC + .1)
        self.assertEqual(g.phase, qz.INTRO)
        self.ask(g)
        return g

    def ask(self, g):
        self.t = g.phase_until + .1
        g.tick(self.t)
        self.assertEqual(g.phase, qz.ASK)

    def times_up(self, g):
        self.t = g.ends_at + .1
        g.tick(self.t)
        self.assertEqual(g.phase, qz.ANSWER)

    def test_norm(self):
        self.assertEqual(norm(" Рио-де-Жанейро! "), norm("рио де жанейро"))
        self.assertEqual(norm("Ёж"), "еж")

    def test_points_last_answer_counts(self):
        g = self.make()
        q = g.question
        right, wrong = q["correct"], q["wrong"]
        g.on_comment(v("Ann"), right.lower())          # first, right from the start: 1.2
        g.on_comment(v("Bob"), wrong[0])
        g.on_comment(v("Bob"), right)                  # changed the mind to the right one: 0.9
        g.on_comment(v("Cat"), right)                  # right: 1
        g.on_comment(v("Dan"), right)
        g.on_comment(v("Dan"), wrong[1])               # changed the mind to a wrong one: nothing
        g.on_comment(v("Eve"), "привет")               # no variant: only flashes
        self.assertEqual([e["kind"] for e in g.events if e["type"] == "try"], ["ok", "ok", "ok", "ok", "ok", "ok", "miss"])
        self.assertEqual(g.snapshot()["answer"], None)                   # not before the time is up
        rows = {r["w"]: r for r in g.snapshot()["variants"]}
        self.assertEqual([p["name"] for p in rows[right]["players"]], ["Ann", "Bob", "Cat"])   # first namer first
        self.assertEqual(rows[wrong[0]]["n"], 0)                          # Bob left it
        self.times_up(g)
        pts = {s["name"]: s["pts"] for s in g.scorers}
        self.assertEqual(pts, {"Ann": 1.2, "Bob": 0.9, "Cat": 1.0})
        self.assertEqual(g.snapshot()["answer"], right)

    def test_first_who_changed_gets_less(self):
        g = self.make()
        q = g.question
        g.on_comment(v("Ann"), q["wrong"][0])
        g.on_comment(v("Ann"), q["correct"])
        g.on_comment(v("Bob"), q["correct"])
        self.times_up(g)
        self.assertEqual({s["name"]: s["pts"] for s in g.scorers}, {"Ann": 1.1, "Bob": 1.0})

    def test_round_winner_and_tie(self):
        g = self.make()
        for i in range(len(g.questions)):
            q = g.question
            g.on_comment(v("Ann"), q["correct"])
            g.on_comment(v("Bob"), q["correct"])
            self.times_up(g)
            g.tick(g.phase_until + .1)
            if g.phase == qz.INTRO:
                self.ask(g)
        self.assertEqual(g.phase, qz.WINNER)
        self.assertEqual(g.players["ann"]["score"], 6.0)                  # first every time: 5 x 1.2
        self.assertEqual(g.winner["name"], "Ann")
        g.on_comment(v("Ann"), "x")                                       # no answers between questions
        self.assertEqual(g.stats.players["ann"]["wins"], 1)
        self.assertEqual(g.history[-1]["questions"][0]["right"], 2)

    def test_tie_wins_for_both(self):
        g = self.make()
        q = g.question
        g.control("finish", {})                                           # nobody answered: no winner
        self.assertIsNone(g.winner)
        g2 = self.make()
        g2.players = {"a": {"id": "a", "name": "A", "avatar": "", "score": 2, "t": 1, "right": 2},
                      "b": {"id": "b", "name": "B", "avatar": "", "score": 2, "t": 2, "right": 2}}
        g2.control("finish", {})
        self.assertEqual([c["n"] for c in g2.stats.champions()], [2])     # both champions with 1 win

    def test_host_controls(self):
        g = self.make()
        end = g.ends_at
        self.assertTrue(g.control("extend", {"sec": 10}))
        self.assertAlmostEqual(g.ends_at, end + 10)
        first = g.question["id"]
        self.assertTrue(g.control("skip", {}))                            # another question of the quiz instead
        self.assertEqual(g.phase, qz.INTRO)
        self.assertNotEqual(g.question["id"], first)
        self.ask(g)
        self.assertTrue(g.control("reveal", {}))
        self.assertEqual(g.phase, qz.ANSWER)
        self.assertTrue(g.control("queue_add", {"topic": "movies"}))
        self.assertFalse(g.control("queue_add", {"topic": "cooking"}).get("ok"))
        g.control("finish", {})
        g.tick(g.phase_until + 1)
        g.tick(g.phase_until + 1)
        g.tick(g.phase_until + 1)
        self.assertEqual(g.topic, "movies")                               # the queued topic first

    def test_four_variants_from_the_game(self):
        g = QuizGame(JsonStore(tempfile.mkdtemp(dir=self.tmp)))
        g.set_option("topics", "geography")
        g.set_option("hints", 4)
        self.t = time.time()
        g.tick(self.t)
        g.tick(g.phase_until + .1)
        self.ask(g)
        rows = g.snapshot()["variants"]
        self.assertEqual(len(rows), 4)
        self.assertTrue(all(r["seed"] and r["n"] == 0 for r in rows))
        self.assertIn(g.question["correct"], [r["w"] for r in rows])
        g.on_comment(v("Ann"), g.question["correct"])                    # still the first one: 1.2
        g.on_comment(v("Bob"), g.question["correct"])
        self.times_up(g)
        self.assertEqual({s["name"]: s["pts"] for s in g.scorers}, {"Ann": 1.2, "Bob": 1.0})

    def test_lettered_options(self):
        g = QuizGame(JsonStore(tempfile.mkdtemp(dir=self.tmp)))
        g.set_option("topics", "geography")
        g.set_option("hints", 6)
        self.t = time.time()
        g.tick(self.t)
        g.tick(g.phase_until + .1)
        self.ask(g)
        rows = g.snapshot()["variants"]
        self.assertEqual([r["tag"] for r in rows], ["АА", "ББ", "ВВ", "ГГ", "ДД", "ЕЕ"][:len(rows)])
        self.assertGreaterEqual(len(rows), 6)
        right = next(r for r in rows if r["w"] == g.question["correct"])
        last = rows[-1]
        g.on_comment(v("Ann"), right["tag"].lower())                     # "аа": the right one by its letter
        for name in ("Bob", "Cat", "Dan"):
            g.on_comment(v(name), last["tag"][0] + last["tag"][1].lower())   # mixed case
        g.on_comment(v("Fay"), right["w"])                               # the word itself counts too
        g.on_comment(v("Gus"), right["tag"] + " " + right["w"])          # and "АА Волга"
        g.on_comment(v("Eve"), "Лиссабон")                                # not one of the options now: only flashes
        snap = g.snapshot()["variants"]
        self.assertEqual([r["w"] for r in snap], [r["w"] for r in rows])  # the order stays, however many players
        self.assertEqual(snap[-1]["n"], 3 if last is not right else 6)
        self.assertEqual(next(r for r in snap if r["w"] == right["w"])["n"], 3 if last is not right else 6)
        self.assertEqual(g.events[-1]["kind"], "miss")
        self.times_up(g)
        self.assertEqual(g.scorers[0]["name"], "Ann")
        self.assertEqual(g.scorers[0]["pts"], 1.2)

    def test_digit_marks(self):
        g = QuizGame(JsonStore(tempfile.mkdtemp(dir=self.tmp)))
        g.set_option("topics", "geography")
        g.set_option("hints", 4)
        g.set_option("tags", "digits")
        self.t = time.time()
        g.tick(self.t)
        g.tick(g.phase_until + .1)
        self.ask(g)
        rows = g.snapshot()["variants"]
        self.assertEqual([r["tag"] for r in rows], ["11", "22", "33", "44"])
        right = next(r for r in rows if r["w"] == g.question["correct"])
        g.on_comment(v("Ann"), right["tag"])
        g.on_comment(v("Bob"), right["w"])                               # the word still counts
        self.times_up(g)
        self.assertEqual({s["name"]: s["pts"] for s in g.scorers}, {"Ann": 1.2, "Bob": 1.0})

    def test_options(self):
        g = QuizGame(JsonStore(tempfile.mkdtemp(dir=self.tmp)))
        self.assertIn("geography,movies", g.OPTIONS["topics"])
        self.assertNotIn("geography,cooking", g.OPTIONS["topics"])
        self.assertNotIn("", g.OPTIONS["topics"])
        g.set_option("topics", "movies,geography")
        self.assertEqual(g.get_options()["topics"], "geography,movies")
        g.set_option("qtime", 60)
        self.assertEqual(g.get_options()["qtime"], 60)

    def test_persistence_roundtrip(self):
        store = JsonStore(tempfile.mkdtemp(dir=self.tmp))
        g = self.make(store)
        g.on_comment(v("Ann"), g.question["correct"])
        g.save()
        g2 = QuizGame(store)
        self.assertEqual(g2.phase, qz.ASK)
        self.assertEqual(g2.question["id"], g.question["id"])
        self.assertEqual(g2.snapshot()["variants"][0]["players"][0]["name"], "Ann")


if __name__ == "__main__":
    unittest.main()
