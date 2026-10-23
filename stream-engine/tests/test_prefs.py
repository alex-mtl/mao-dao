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
        g.tick(time.time()); g.tick(time.time() + 60)          # past the countdown
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


class GiftBackfillTest(unittest.TestCase):
    def test_sent_counts_from_the_journals(self):
        import json
        import os
        root = tempfile.mkdtemp()
        os.makedirs(root + "/rooms/gw1")
        with open(root + "/rooms/gw1/gifts.jsonl", "w", encoding="utf-8") as f:
            for g, n, to in (("Eye for an Eye", 2, None), ("Eye for an Eye", 1, None), ("Rose", 5, "someguest")):
                f.write(json.dumps({"gift": g, "count": n, "to": to}) + "\n")
        c = GiftCatalog(root + "/gifts_seen.json")
        seen = {g["name"]: g["seen"] for g in c.list()}
        self.assertEqual(seen.get("Eye for an Eye"), 3)
        self.assertNotIn("Rose", seen)                                   # a gift to a guest doesn't count
        c.record("Eye for an Eye", 1)
        c.save()
        self.assertEqual({g["name"]: g["seen"] for g in GiftCatalog(root + "/gifts_seen.json").list()}["Eye for an Eye"], 4)   # once


class StealAndBoostTest(unittest.TestCase):
    def game(self):
        h = Hub(JsonStore(tempfile.mkdtemp()), username="host")
        h.set_active("guess")
        g = h.game
        g.tick(time.time()); g.tick(time.time() + 60)                        # past the countdown: playing
        return h, g

    def test_defaults(self):
        r = GiftRules()
        self.assertEqual(r.actions_for("Monster Box!", 0), {"steal"})          # bound: no hint for it
        self.assertEqual(r.actions_for("Ghostfire", 0), {"boost"})
        self.assertEqual(r.actions_for("Rose", 1), {"hint"})

    def test_steal_the_win(self):
        from app.games.guess import game as gm
        h, g = self.game()
        nina = Viewer("nina", "Нина", "", 1)
        g.on_comment(nina, g.sem.words[int(g.order[3])])                       # close, but...
        h.gift(Viewer("thief", "Thief", "", 0), "Monster Box!", 1)             # ...the gift wins it, even not following
        self.assertEqual(g.phase, gm.WINNER)
        self.assertEqual(g.winner["name"], "Thief")
        win = [e for e in g.events if e["type"] == "winner"][-1]
        self.assertTrue(win["stolen"])
        self.assertTrue(any(e["type"] == "steal" for e in g.events))
        h.gift(Viewer("late", "Late", "", 1), "Monster Box!", 1)               # the round is over: nothing
        self.assertEqual(g.winner["name"], "Thief")

    def test_boost_for_the_whole_stream(self):
        h, g = self.game()
        r = lambda k: g.sem.words[int(g.order[k])]
        for pid, k in (("a", 5), ("b", 6), ("c", 7)):                          # 3 round champions: others may not
            g.on_comment(Viewer(pid, pid, "", 1), r(k))
        eve = Viewer("eve", "Eve", "", 1)
        h.gift(eve, "Ghostfire", 1)
        g.on_comment(eve, r(40) + " " + r(41))
        self.assertEqual(g.players["eve"].guesses, 2)
        self.assertIn("eve", g.boost_ids)
        g._finish(time.time(), "timeout"); g._clear_round()                  # next round: still boosted
        self.assertIn("eve", g.boost_ids)
        self.assertIn("eve", GuessGameFrom(g).boost_ids)                     # survives a restart
        g.new_session()                                                       # a new stream: over
        self.assertEqual(g.boost_ids, set())


def GuessGameFrom(g):
    from app.games.guess.game import GuessGame
    return GuessGame(g.store)


class GiftPromosTest(unittest.TestCase):
    def test_promo_items_follow_the_rules(self):
        h = Hub(JsonStore(tempfile.mkdtemp()), username="host")
        h.set_options("gifts", {"hint": "gift:Rose", "bomber": "min:10", "multi": ""})
        items = {p["action"]: p for p in h.message("guess")["giftPromos"]}
        self.assertEqual(list(items)[:2], ["hint", "bomber"])                     # the promo order
        self.assertEqual((items["hint"]["gift"], items["bomber"]["coins"]), ("Rose", 10))
        self.assertNotIn("multi", items)                                          # no gift: no promo
        self.assertEqual(items["steal"]["gift"], "Monster Box!")                  # the defaults are shown too
        h.set_options("gifts", {"steal": ""})
        self.assertNotIn("steal", [p["action"] for p in h.message("guess")["giftPromos"]])   # follows at once


class MonitorTest(unittest.TestCase):
    """The room page's monitor: the round now, the stream's rounds, what's planned, the host's controls."""

    def game(self):
        h = Hub(JsonStore(tempfile.mkdtemp()), username="host")
        h.set_active("guess")
        g = h.game
        g.tick(time.time()); g.tick(time.time() + 60)                        # past the countdown: playing
        return h, g

    def test_the_round_now(self):
        h, g = self.game()
        nina = Viewer("nina", "Нина", "", 1)
        g.on_comment(nina, g.sem.words[int(g.order[4])])
        h.gift(nina, "Rose", 1)                                              # any gift: a hint
        m = g.monitor()["current"]
        self.assertEqual((m["round"], m["word"], m["players"]), (1, g.secret.upper(), 1))
        self.assertEqual(m["people"][0]["name"], "Нина")
        self.assertGreaterEqual(m["pace"], 1)
        self.assertEqual(m["top"][0]["rank"], min(x["rank"] for x in m["top"]))
        self.assertIn("gift", [e["type"] for e in m["log"]])
        self.assertEqual(len(m["hints"]), 1)

    def test_pause_stops_the_timers_and_the_guesses(self):
        h, g = self.game()
        left = g.ends_at - time.time()
        self.assertTrue(g.control("pause", {}))
        self.assertTrue(g.snapshot()["hostPaused"])
        g.on_comment(Viewer("nina", "Нина", "", 1), g.sem.words[int(g.order[4])])
        self.assertEqual(g.players, {})                                      # paused: no guesses
        g.frozen["at"] -= 100; g.frozen["elapsed"] -= 0                      # 100 s of pause...
        g.tick(time.time() + 10_000)                                         # ...the round doesn't end
        self.assertEqual(g.phase, "playing")
        self.assertTrue(g.control("resume", {}))
        self.assertAlmostEqual(g.ends_at - time.time(), left, delta=2)
        self.assertTrue(g.control("extend", {"min": 5}))
        self.assertAlmostEqual(g.ends_at - time.time(), left + 300, delta=2)

    def test_skip_finish_and_the_stream_rounds(self):
        h, g = self.game()
        word = g.secret
        self.assertTrue(g.control("skip", {}))                               # the word stays secret
        self.assertTrue(g.word_hidden)
        self.assertFalse(g.control("skip", {}))                              # no round now
        past = g.monitor()["past"]
        self.assertEqual((past[0]["round"], past[0]["word"], past[0]["hidden"]), (1, word, True))
        g.phase = "finished"; g.tick(time.time()); g.tick(time.time() + 60)
        self.assertTrue(g.control("finish", {}))
        self.assertEqual([r["round"] for r in g.monitor()["past"]], [2, 1])
        g.history.append(dict(g.history[-1], round=40))                      # an old stream's round: not shown
        g.history = [dict(g.history[-1], round=40)] + g.history[:-1]
        self.assertEqual([r["round"] for r in g.monitor()["past"]], [2, 1])

    def test_word_queue_and_a_break(self):
        h, g = self.game()
        g.queue_custom({"id": "v1", "word": g.sem.words[100], "name": "Нина", "tiktok_id": "nina"})
        self.assertEqual(g.control("queue_add", {"word": "qqqzzz"}), {"ok": False, "error": "not_in_dictionary"})
        self.assertTrue(g.control("queue_add", {"word": g.sem.words[200], "first": True}))
        q = g.monitor()["plan"]["queue"]
        self.assertEqual([x["host"] for x in q], [True, False])
        self.assertTrue(g.control("queue_move", {"id": "v1", "to": 0}))
        self.assertEqual(g.monitor()["plan"]["queue"][0]["id"], "v1")
        self.assertTrue(g.control("queue_remove", {"id": "v1"}))
        self.assertTrue(g.control("break_after", {"round": 1}))
        g.control("finish", {})
        g.phase = "finished"
        g.tick(time.time())
        self.assertIsNotNone(g.frozen)                                       # the break: no new round
        self.assertEqual(g.round_id, 1)
        g.control("resume", {})
        g.tick(time.time())
        self.assertEqual(g.round_id, 2)
        self.assertIsNone(g.setter)                                          # the host's word: nobody to name
        self.assertEqual(g.secret, g.sem.words[200])

    def test_a_viewers_word_added_by_the_host(self):
        h, g = self.game()
        g.control("finish", {})
        word = g.sem.words[300]
        self.assertTrue(g.control("queue_add", {"word": word, "tiktok_id": "Innusya", "name": "Иннуся"}))
        q = g.monitor()["plan"]["queue"][0]
        self.assertEqual((q["name"], q["host"], q["manual"]), ("Иннуся", False, True))
        g.phase = "finished"; g.tick(time.time())
        self.assertEqual((g.secret, g.setter["name"], g.setter["id"]), (word, "Иннуся", "innusya"))
        g.tick(time.time() + 60)
        g.on_comment(Viewer("innusya", "Иннуся", "", 1), word)               # her own word: she can't guess it
        self.assertEqual(g.phase, "playing")
