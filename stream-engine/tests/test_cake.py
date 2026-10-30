"""The cake show's clock on the server (reactions/cake.py): crackers one a second and one per "огонь", the finale
after the last one, the moments in the LIVE log, one show at a time."""

import unittest

from app.reactions import cake as C
from app.reactions.cake import CakeShows


class CakeShowsTest(unittest.TestCase):
    def setUp(self):
        self.feed, self.log = [], []
        self.c = CakeShows(lambda **e: self.feed.append(e), lambda kind, **f: self.log.append((kind, f, self.now)))
        self.now = 0.0

    def run_until(self, t, step=0.25):
        while self.now < t:
            self.now = round(self.now + step, 3)
            self.c.tick(self.now)

    def types(self, kind):
        return [e for e in self.feed if e["type"] == kind]

    def test_quiet_chat_one_a_second_then_finale_and_log(self):
        seed = self.c.add({"id": "a", "name": "Ann", "avatar": "", "total": 5000})
        self.run_until(200)
        start = self.types("cake")[0]
        self.assertEqual((start["seed"], start["name"], start["server"]), (seed, "Ann", True))
        self.assertEqual(len(self.types("cake_fire")), C.CRACKERS)
        kinds = [k for k, _, _ in self.log]
        self.assertEqual(kinds, ["cake_start", "cake_last", "cake_split"])
        t_start, t_last, t_split = [t for _, _, t in self.log]
        # first take-off LIT + FIRST after the start, then 99 more a second apart (ticks of .25 s)
        self.assertAlmostEqual(t_last - t_start, C.LIT + C.FIRST + (C.CRACKERS - 1) * C.GAP, delta=0.3)
        self.assertAlmostEqual(t_split - t_last, C.FLIGHT + C.TO_FINAL + C.TO_SPLIT, delta=0.3)
        self.assertEqual(len(self.types("cake_final")), 1)
        self.assertIsNone(self.c.cur)

    def test_chat_fires_speed_it_up_and_wait_for_the_fuses(self):
        self.c.add({"id": "a", "name": "Ann", "avatar": ""})
        self.run_until(1)
        for i in range(30):                                   # before the fuses are lit: they wait
            self.assertTrue(self.c.comment(f"v{i}", "ОГОНЬ!!"))
        self.assertFalse(self.c.comment("x", "hello"))
        self.assertEqual(len(self.types("cake_fire")), 0)
        self.run_until(C.LIT + C.FIRST + 5)
        named = [e["name"] for e in self.types("cake_fire") if e["name"]]
        self.assertEqual(named, [f"v{i}" for i in range(30)])  # in order, .12 s apart
        for i in range(80):                                   # after: at once
            self.c.comment("w", "fire")
        self.run_until(400)
        self.assertEqual(len(self.types("cake_fire")), C.CRACKERS)
        _, _, t_last = [x for x in self.log if x[0] == "cake_last"][0]
        self.assertLess(t_last, C.LIT + C.FIRST + 6)

    def test_one_show_at_a_time(self):
        s1 = self.c.add({"id": "a", "name": "Ann", "avatar": ""})
        s2 = self.c.add({"id": "b", "name": "Bob", "avatar": ""})
        self.run_until(50)
        self.assertEqual([e["seed"] for e in self.types("cake")], [s1])
        self.run_until(300)
        self.assertEqual([e["seed"] for e in self.types("cake")], [s1, s2])
        self.assertEqual([k for k, _, _ in self.log].count("cake_split"), 2)


if __name__ == "__main__":
    unittest.main()
