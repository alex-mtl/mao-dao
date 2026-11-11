"""Listen mode through the hub: the panel's greeting flags, subscriptions, battles end to end, the LIVE's counters."""

import json
import os
import tempfile
import unittest

from app import config, live_log
from app.games.base import Viewer
from app.hub import Hub
from app.storage import JsonStore
from tests.test_live_log import FakeAvatars, lines, tiny_assets
from tests.test_battles import RIVAL, HOST, armies, finish, open_info


class ListenHubTest(unittest.TestCase):
    def setUp(self):
        self.saved = config.ASSETS_DIR, config.COUNTDOWN_SEC, live_log._avatars
        config.ASSETS_DIR, config.COUNTDOWN_SEC = tiny_assets(), 0
        self.dir = tempfile.mkdtemp()
        live_log._avatars = FakeAvatars(os.path.join(self.dir, "avatars"))
        self.hub = Hub(JsonStore(os.path.join(self.dir, "rooms", "r")), username="host")

    def tearDown(self):
        config.ASSETS_DIR, config.COUNTDOWN_SEC, live_log._avatars = self.saved

    def joins(self):
        return [e for e in self.hub.feed if e["type"] == "join"]

    def test_listen_is_a_mode(self):
        self.assertIn("listen", self.hub.games)
        self.hub.set_active("listen")
        self.assertEqual(self.hub.active, "listen")
        self.hub.message("listen")                       # the overlay's state of the mode: empty, but it builds

    def test_greeting_for_the_overlay_and_for_the_panel_are_separate(self):
        h = self.hub
        h.set_options("global", {"greet": 0, "say_greet": 0})
        h.join(Viewer("a", "Ann"))
        self.assertEqual(self.joins(), [])               # both off: nobody is greeted
        h.set_options("global", {"say_greet": 1})
        h.join(Viewer("b", "Bob"))
        self.assertEqual([(e["name"], e["overlay"], e["panel"]) for e in self.joins()], [("Bob", False, True)])
        h.set_options("global", {"greet": 1, "say_greet": 0})
        h.join(Viewer("c", "Cat"))
        self.assertEqual([(e["name"], e["overlay"], e["panel"]) for e in self.joins()][-1], ("Cat", True, False))
        self.assertEqual(h.options()["global"]["say_chat"], 0)

    def test_say_settings_are_saved_and_checked(self):
        h = self.hub
        h.set_options("global", {"say_chat": 1, "say_greet": 7})
        self.assertEqual((h.global_settings.get("SAY_CHAT"), h.global_settings.get("SAY_GREET")), (True, config.SAY_GREET))

    def test_counters_subscription_and_battle(self):
        h = self.hub
        h.new_live("9001")
        h.set_host_uid(HOST)
        ann = Viewer("ann", "Ann", "", 1, 0, "1")
        h.battle(open_info())
        h.comment(ann, "hello")
        h.like(ann, 7)
        h.gift(ann, "Rose", 2, coins=5)
        h.subscribe(ann, 3)
        h.follow(ann)
        h.battle(armies(mine=120, theirs=80))
        h.battle(finish(ms=(120, 80)))
        snap = h.stats.snapshot()
        self.assertEqual({k: snap["totals"][k] for k in ("comments", "likes", "gifts", "coins", "subs", "follows")},
                         {"comments": 1, "likes": 7, "gifts": 2, "coins": 10, "subs": 1, "follows": 1})
        b = h.battles.snapshot()["recent"][0]
        self.assertEqual((b["result"], b["ours"], b["theirs"]), ("win", 120, 80))
        self.assertEqual(b["during"], {"comments": 1, "likes": 7, "gifts": 2, "coins": 10, "subs": 1, "follows": 1})
        out = lines(h)
        self.assertEqual([x["months"] for x in out if x["type"] == "sub"], [3])
        battle = next(x for x in out if x["type"] == "battle")
        self.assertEqual((battle["result"], battle["ours"], battle["theirs"], battle["rival"]), ("win", 120, 80, "Rival"))
        with open(h.store.path("battles.jsonl"), encoding="utf-8") as f:
            self.assertEqual(len(f.readlines()), 1)

    def test_a_new_live_resets_the_counters(self):
        h = self.hub
        h.new_live("9001")
        h.comment(Viewer("ann", "Ann", "", 1, 0, "1"), "hi")
        self.assertEqual(h.stats.snapshot()["totals"]["comments"], 1)
        h.new_live("9002")
        self.assertEqual(h.stats.snapshot()["totals"]["comments"], 0)

    def test_gift_to_a_guest_is_not_the_hosts(self):
        h = self.hub
        h.new_live("9003")
        h.gift(Viewer("ann", "Ann", "", 1, 0, "1"), "Rose", 1, to="someoneelse", coins=5)
        self.assertEqual(h.stats.snapshot()["totals"]["gifts"], 0)


if __name__ == "__main__":
    unittest.main()
