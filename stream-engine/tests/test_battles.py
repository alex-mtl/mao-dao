"""Listen mode: battles and their rounds (app/battles.py), the LIVE's counters (app/listen_stats.py) and the
extraction of TikTok's battle events (app/tiktok/battles.py). No TikTok, no dictionaries needed."""

import json
import os
import tempfile
import unittest
from types import SimpleNamespace as NS

from app.battles import BattleTracker
from app.listen_stats import ListenStats
from app.storage import JsonStore
from app.tiktok import battles as tb

HOST, RIVAL = "111", "222"


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


def open_info(bid=1, ch=7, start=None):
    return {"kind": "battle", "action": "OPEN", "battle_id": bid, "channel_id": ch, "start_ms": start or 1_000_000_000,
            "duration": 300, "extra_sec": 0, "status": "BATTLE_STARTED", "type": "", "scores": {}, "results": {},
            "anchors": {HOST: {"name": "Host", "handle": "host"}, RIVAL: {"name": "Rival", "handle": "rival"}}}


def armies(bid=1, ch=7, mine=0, theirs=0, reason="SCORE_UPDATE"):
    return {"kind": "armies", "battle_id": bid, "channel_id": ch, "reason": reason, "duration": 300,
            "scores": {HOST: mine, RIVAL: theirs}, "supporters": {HOST: [{"id": "u1", "name": "Ann", "score": mine}]}}


def finish(bid=1, ch=7, mine="WIN", theirs="LOSE", ms=(500, 300)):
    return {"kind": "battle", "action": "FINISH", "battle_id": bid, "channel_id": ch, "duration": 300, "anchors": {},
            "scores": {}, "results": {HOST: {"result": mine, "score": ms[0]}, RIVAL: {"result": theirs, "score": ms[1]}}}


class TrackerTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.clock = Clock()
        self.path = os.path.join(self.dir, "battles.jsonl")
        self.t = BattleTracker(self.path, clock=self.clock)
        self.t.set_host(HOST)

    def test_one_battle_win(self):
        self.t.on_battle(open_info())
        self.clock.t += 30
        self.t.on_armies(armies(mine=100, theirs=40))
        self.t.note("gifts", 2)
        self.t.note("coins", 99)
        self.assertEqual(self.t.snapshot()["current"]["ours"], 100)
        self.clock.t += 270
        self.t.on_armies(armies(mine=500, theirs=300, reason="BATTLE_END"))
        self.t.on_battle(finish())
        self.assertIsNone(self.t.current)
        b = self.t.snapshot()["recent"][0]
        self.assertEqual((b["result"], b["ours"], b["theirs"], b["round"], b["rival"]), ("win", 500, 300, 1, "Rival"))
        self.assertEqual(b["during"], {"gifts": 2, "coins": 99})
        self.assertEqual(b["support"][HOST][0]["name"], "Ann")
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(len(f.readlines()), 1)

    def test_rounds_of_one_channel_are_numbered(self):
        for bid in (1, 2, 3):
            self.t.on_battle(open_info(bid=bid))
            self.t.on_armies(armies(bid=bid, mine=10 * bid, theirs=5))
            self.clock.t += 200
            self.t.on_battle(finish(bid=bid, mine="WIN" if bid != 2 else "LOSE", theirs="LOSE" if bid != 2 else "WIN"))
            self.clock.t += 20
        snap = self.t.snapshot()
        self.assertEqual([b["round"] for b in reversed(snap["recent"])], [1, 2, 3])
        self.assertEqual((snap["totals"]["win"], snap["totals"]["loss"]), (2, 1))
        self.assertEqual(len(snap["series"]), 3)

    def test_gap_starts_a_new_series(self):
        self.t.on_battle(open_info(bid=1))
        self.t.on_battle(finish(bid=1))
        self.clock.t += 4000
        self.t.on_battle(open_info(bid=2))
        self.assertEqual(self.t.current["round"], 1)

    def test_joined_midway_and_no_result_event(self):
        self.t.on_armies(armies(bid=9, mine=70, theirs=90))
        self.assertTrue(self.t.current["mid"])
        self.clock.t += 400
        self.t.on_armies(armies(bid=9, mine=70, theirs=90, reason="BATTLE_END"))
        self.clock.t += 25
        self.t.tick()                                   # no finish event: closed by the points
        self.assertIsNone(self.t.current)
        self.assertEqual(self.t.snapshot()["recent"][0]["result"], "loss")

    def test_stale_battle_is_unfinished(self):
        self.t.on_battle(open_info())
        self.clock.t += 700
        self.t.tick()
        self.assertEqual(self.t.snapshot()["recent"][0]["result"], "unfinished")

    def test_unknown_host_does_not_guess_a_winner(self):
        self.t.set_host("")
        self.t.on_battle(open_info())
        self.t.on_armies(armies(mine=5, theirs=1))
        self.t.on_battle(finish())
        b = self.t.snapshot()["recent"][0]
        self.assertEqual((b["result"], b["known"]), ("", False))

    def test_journal_survives_restart(self):
        self.t.on_battle(open_info())
        self.t.on_battle(finish())
        again = BattleTracker(self.path, clock=self.clock)
        self.assertEqual(again.snapshot()["totals"]["battles"], 1)
        self.clock.t += 60
        again.on_battle(open_info(bid=2))
        self.assertEqual(again.current["round"], 2)


class StatsTest(unittest.TestCase):
    def test_counters_tops_and_restore(self):
        store = JsonStore(tempfile.mkdtemp())
        s = ListenStats(store, clock=Clock())
        a, b = NS(id="a", name="Ann"), NS(id="b", name="Bob")
        s.comment(a)
        s.comment(a)
        s.like(b, 30)
        s.gift(b, "Rose", 3, 1)
        s.follow(a)
        s.sub(a)
        s.join(a)
        snap = s.snapshot()
        self.assertEqual(snap["totals"]["comments"], 2)
        self.assertEqual(snap["totals"]["coins"], 3)
        self.assertEqual(snap["totals"]["viewers"], 2)
        self.assertEqual(snap["top"]["coins"][0]["name"], "Bob")
        self.assertEqual(snap["top"]["comments"][0]["n"], 2)
        s.save()
        again = ListenStats(store, clock=Clock())
        self.assertEqual(again.snapshot()["totals"]["likes"], 30)


class ExtractTest(unittest.TestCase):
    def test_battle_event(self):
        user = lambda i, n: NS(user=NS(user_id_str=i, nickname=n, display_id=n.lower(), avatar_thumb=None))
        ev = NS(action=NS(name="OPEN"), battle_id=5,
                battle_settings=NS(battle_id=5, channel_id=77, start_time_ms=1_700_000_000_000, duration=300,
                                   extra_duration_second=0, status=NS(name="BATTLE_STARTED"), battle_type=NS(name="X")),
                anchors_info=[NS(key=111, value=user("111", "Host")), NS(key=222, value=user("222", "Rival"))],
                battle_result={}, armies=[])
        info = tb.battle_info(ev)
        self.assertEqual((info["action"], info["battle_id"], info["channel_id"], info["duration"]), ("OPEN", 5, 77, 300))
        self.assertEqual(info["anchors"]["222"]["name"], "Rival")

    def test_armies_event(self):
        ev = NS(trigger_reason=NS(name="SCORE_UPDATE"), battle_id=5, battle_settings=None,
                armies={111: NS(hostscore=40, user_armies=[NS(user_id_str="u1", nickname="Ann", score=12)]),
                        222: NS(hostscore=30, user_armies=[])})
        info = tb.armies_info(ev)
        self.assertEqual(info["scores"], {"111": 40, "222": 30})
        self.assertEqual(info["supporters"]["111"][0], {"id": "u1", "name": "Ann", "score": 12})
        self.assertEqual(info["battle_id"], 5)
        json.dumps(info)


if __name__ == "__main__":
    unittest.main()
