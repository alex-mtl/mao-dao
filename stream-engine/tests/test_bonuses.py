"""Viewers' bonuses on account (app/bonuses.py): the copy here, the outbox for Laravel, a cake by a club emote."""

import asyncio
import tempfile
import unittest

from app import config
from app.bonuses import BonusAccounts, BonusSync
from app.games.base import Viewer
from app.storage import JsonStore


class BonusAccountsTest(unittest.TestCase):
    def setUp(self):
        self.saved = config.PLATFORM_URL
        config.PLATFORM_URL = "http://platform.test"

    def tearDown(self):
        config.PLATFORM_URL = self.saved

    def test_old_hint_file_is_read_and_changes_go_to_the_outbox(self):
        store = JsonStore(tempfile.mkdtemp())
        store.save("guess/hint_credits.json", {"Eva": 2})
        acc = BonusAccounts(store)
        self.assertEqual(acc.of_kind("hint"), {"eva": 2})
        self.assertEqual(acc.add("@EVA", "cake", 1, "host"), 1)
        self.assertEqual(acc.add("eva", "cake", -5, "spend"), 0)              # never below 0: -1 really
        self.assertEqual([(o["kind"], o["delta"]) for o in acc.outbox], [("cake", 1), ("cake", -1)])
        self.assertEqual(acc.add("eva", "nonsense", 1), 0)                    # unknown kinds are ignored
        again = BonusAccounts(store)                                          # kept across restarts
        self.assertEqual((again.of("eva"), len(again.outbox)), ({"hint": 2}, 2))

    def test_platform_balances_plus_ops_it_has_not_seen(self):
        acc = BonusAccounts(JsonStore(tempfile.mkdtemp()))
        acc.add("eva", "hint", 3, "gift")
        acc.add("eva", "hint", -1, "spend")
        acc.set_viewer("eva", {"hint": 10, "cake": 1})                        # the host's change on the panel
        self.assertEqual(acc.of("eva"), {"hint": 12, "cake": 1})              # + our 2, not yet sent
        acc.rename("eva", "eva_real")
        self.assertEqual((acc.of("eva"), acc.of("eva_real")), ({}, {"hint": 12, "cake": 1}))

    def test_sync_migrates_once_then_pushes_ops(self):
        store = JsonStore(tempfile.mkdtemp())
        store.save("guess/hint_credits.json", {"eva": 2})
        acc = BonusAccounts(store)
        sync = BonusSync(acc, "gw1")
        calls = []

        async def api(method, body=None):
            calls.append((method, body))
            if method == "GET":
                return {"balances": {"bob": {"cake": 1}}}
            got = {}
            for o in body["ops"]:
                got.setdefault(o["viewer"], {}).setdefault(o["kind"], 0)
                got[o["viewer"]][o["kind"]] += o["delta"]
            return {"balances": got}
        sync.api = api
        asyncio.run(sync.pull())
        self.assertEqual(acc.of_kind("hint"), {"eva": 2})                     # pending migration counted
        self.assertEqual(acc.of("bob"), {"cake": 1})
        asyncio.run(sync.flush())
        self.assertEqual(calls[-1][1]["ops"][0]["op"], "migrate-gw1-hint-eva")
        self.assertEqual((acc.outbox, acc.of("eva")), ([], {"hint": 2}))
        asyncio.run(sync.pull())                                              # migrated: not sent again
        self.assertEqual(acc.outbox, [])


class CakeEmoteTest(unittest.TestCase):
    def test_a_club_emote_bound_to_cake_spends_one_from_the_account(self):
        from app.hub import Hub
        hub = Hub(JsonStore(tempfile.mkdtemp()))
        g = hub.games["guess"]
        shows = []
        hub.cakes.add = lambda who: shows.append(who["id"]) or 1
        hub.set_options("emotes", {"555": "cake"})
        nina = Viewer("ninemdaz", "Nina", "", 1)
        hub.emote(nina, [("555", "")])                                        # nothing on account: nothing
        self.assertEqual(shows, [])
        g.bonuses.add("ninemdaz", "cake", 2, "host")
        hub.emote(nina, [("555", "")])
        self.assertEqual((shows, g.bonuses.get("ninemdaz", "cake")), (["ninemdaz"], 1))


if __name__ == "__main__":
    unittest.main()
