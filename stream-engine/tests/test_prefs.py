"""Room settings from the platform's room page: gift rules, gift animations, toast settings."""

import tempfile
import time
import unittest

from app.games.base import Viewer
from app.hub import Hub
from app.room_prefs import GiftCatalog, GiftRules, Toasts
from app.storage import JsonStore


class GiftRulesTest(unittest.TestCase):
    def test_any_gift_gives_a_hint_by_default(self):
        r = GiftRules()
        self.assertEqual(r.actions_for("Rose", 1), {"hint"})
        self.assertEqual(r.actions_for("Lion", 29999), {"hint"})

    def test_a_bound_gift_does_only_its_action(self):
        r = GiftRules({"balloon": "gift:Rose", "plane": "min:100", "multi": "gift:Finger Heart"})
        self.assertEqual(r.actions_for("rose", 1), {"balloon"})            # no hint: the rose is taken
        self.assertEqual(r.actions_for("Finger Heart", 5), {"multi"})
        self.assertEqual(r.actions_for("Corgi", 299), {"plane"})           # from 100 coins
        self.assertEqual(r.actions_for("Heart Me", 1), {"hint"})           # anything else: the hint

    def test_off_and_bad_rules(self):
        r = GiftRules({"hint": "", "plane": "min:7", "skip": "any", "bomber": "gift:"})
        self.assertEqual(r.actions_for("Rose", 1), set())                  # hint switched off
        self.assertNotIn("plane", r.values())                              # 7 is not a step
        self.assertNotIn("skip", r.values())                               # no such action
        self.assertNotIn("bomber", r.values())


class GiftAnimationsTest(unittest.TestCase):
    def hub(self, rules):
        h = Hub(JsonStore(tempfile.mkdtemp()), username="host")
        h.set_options("gifts", rules)
        return h

    def feed(self, h, kind):
        return [e for e in h.feed if e["type"] == kind]

    def test_ten_gifts_ten_planes(self):
        h = self.hub({"plane": "gift:Rose"})
        mao = Viewer("mao", "Mao", "", 1)
        h.gift(mao, "Rose", 1)                                  # the combo starts...
        h.gift(mao, "Rose", 9, repeat=True)                     # ...and goes on: 10 in all
        planes = self.feed(h, "plane")
        self.assertEqual(len(planes), 10)
        self.assertFalse(any(p["bomber"] for p in planes))

    def test_butterflies_and_balloons_for_gifts(self):
        h = self.hub({"bomber": "gift:Doughnut", "balloon": "gift:Finger Heart"})
        v = Viewer("v", "V", "", 1)
        h.gift(v, "Doughnut", 2, coins=30)                      # bound by name: butterflies only
        self.assertEqual([p["bomber"] for p in self.feed(h, "plane")], [True, True])
        self.assertEqual(self.feed(h, "balloon"), [])
        h.gift(v, "Finger Heart", 3, coins=5)                   # bound by name: balloons
        self.assertEqual(len(self.feed(h, "balloon")), 3)

    def test_gift_to_a_guest_does_nothing(self):
        h = self.hub({"plane": "any"})
        h.gift(Viewer("v", "V", "", 1), "Rose", 3, to="someguest")
        self.assertEqual(self.feed(h, "plane"), [])

    def test_three_words_for_a_gift(self):
        h = self.hub({"multi": "gift:Finger Heart"})
        h.set_active("guess")
        g = h.game
        g.tick(time.time()); g.tick(time.time() + 60)            # past the countdown: playing
        for pid in ("a", "b", "c"):                             # three round champions: others may not
            g.on_comment(Viewer(pid, pid, "", 1), g.sem.words[int(g.order[10 + ord(pid)])])
        words = [w for w in ("water", "fire", "house") if w != g.secret]
        eve = Viewer("eve", "Eve", "", 1)
        g.on_comment(eve, " ".join(words))
        self.assertNotIn("eve", g.players)
        h.gift(eve, "Finger Heart", 1, coins=5)
        g.on_comment(eve, " ".join(words))
        self.assertEqual(g.players["eve"].guesses, 3)


class ToastsTest(unittest.TestCase):
    def test_only_known_ids_and_rates(self):
        t = Toasts({"leader": {"show": 0}, "hint": {"voice": 0, "rate": 1.25}, "nope": {"show": 0},
                    "round": {"rate": 3}})
        self.assertEqual(t.values(), {"leader": {"show": 0}, "hint": {"voice": 0, "rate": 1.25}})
        t.set({"hint": {"rate": None}})                         # back to the default speed
        self.assertEqual(t.values()["hint"], {"voice": 0})
        t.set({"leader": {"anim": "auto"}, "jump": {"anim": 0.2}, "top": {"anim": 0.3}})
        self.assertEqual(t.values()["leader"], {"show": 0, "anim": "auto"})
        self.assertEqual(t.values()["jump"], {"anim": 0.2})
        self.assertNotIn("top", t.values())                      # 0.3 is not a step

    def test_pages_get_them_and_they_survive_a_restart(self):
        store = JsonStore(tempfile.mkdtemp())
        h = Hub(store, username="host")
        h.set_options("toasts", {"greet": {"voice": 0}})
        h.set_options("gifts", {"plane": "gift:Rose"})
        self.assertEqual(h.message("guess")["toasts"], {"greet": {"voice": 0}})
        h2 = Hub(store, username="host")
        self.assertEqual(h2.toasts.values(), {"greet": {"voice": 0}})
        self.assertEqual(h2.gift_rules.values()["plane"], "gift:Rose")


class GiftCatalogTest(unittest.TestCase):
    def test_tiktok_list_and_popularity(self):
        import json
        path = tempfile.mkdtemp() + "/gifts.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"Rose": 1, "Eye for an Eye": 0}, f)                  # an old file: {name: coins}
        c = GiftCatalog(path)
        self.assertTrue(c.needs_refresh())
        c.refresh_from_tiktok([{"name": "Rose", "diamond_count": 1, "image": {"url_list": ["https://x/rose.png"]}},
                               {"name": "Panther", "diamond_count": 10, "image": {"url_list": ["https://x/p.png"]}},
                               {"name": "Lion", "diamond_count": 29999, "image": {}}])
        self.assertFalse(c.needs_refresh())
        c.record("Panther", 10); c.record("Panther", 10); c.record("Rose", 1)
        c.save()                                                              # (the hub's saver: once a minute)
        c2 = GiftCatalog(path)
        names = [g["name"] for g in c2.list()]
        self.assertEqual(names[:2], ["Panther", "Rose"])                       # sent most often first
        self.assertEqual({g["name"]: g["image"] for g in c2.list()}["Panther"], "https://x/p.png")
        self.assertEqual(names[-1], "Lion")                                        # never sent: by price
        self.assertIn("Eye for an Eye", names)                                     # the old file's gifts stay
        rose = next(g for g in c2.list() if g["name"] == "Rose")
        self.assertEqual((rose["ru"], rose["theme"]), ("Роза", "flower"))       # Russian names and themes


class HostReportsTest(unittest.TestCase):
    """The data behind the host's /round and /history in the bot."""

    def test_round_and_history(self):
        from app.games.guess.game import GuessGame
        g = GuessGame(JsonStore(tempfile.mkdtemp()))
        g.tick(time.time()); g.tick(time.time() + 0.01)
        r = lambda k: g.sem.words[int(g.order[k])]
        nina, tati = Viewer("nina", "Нина", "", 1), Viewer("tati", "Tati", "", 1)
        g.on_comment(nina, r(30)); g.on_comment(nina, r(5)); g.on_comment(tati, r(200))
        rep = g.round_report()
        self.assertEqual((rep["word"], rep["players"], rep["guesses"]), (g.secret.upper(), 2, 3))
        self.assertEqual([w[0] for w in rep["who"]], ["Нина", "Tati"])           # closest first
        self.assertEqual([t[1] for t in rep["top"]], [6, 31, 201])
        g.on_comment(tati, g.secret)                                             # Tati wins
        h = g.history_report(3)
        self.assertEqual(len(h), 1)
        self.assertEqual(h[0]["winner"], "Tati")
        self.assertEqual([w[1] for w in h[0]["winner_words"]], [1, 201])        # her words, closest first
        self.assertEqual(h[0]["top"][0][:2], [g.secret.upper(), 1])


class VolumesTest(unittest.TestCase):
    def test_voice_and_effects_volume(self):
        h = Hub(JsonStore(tempfile.mkdtemp()), username="host")
        msg = h.message("guess")
        self.assertEqual((msg["voiceVolume"], msg["fxVolume"]), (100, 100))      # full volume by default
        h.set_options("global", {"voice_volume": 60, "fx_volume": 30})
        h.set_options("global", {"fx_volume": 35})                                 # steps of 10 only
        msg = h.message("guess")
        self.assertEqual((msg["voiceVolume"], msg["fxVolume"]), (60, 30))
