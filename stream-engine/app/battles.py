"""Battles of the room's host (TikTok LIVE "battle" = a duel of two streamers on one screen), recorded for statistics.

Fed by the hub with the dicts of app/tiktok/battles.py. A battle has one id (battle_id); a *series* is the battles
of one match channel (channel_id): a match of several rounds is several battles, one after another, in the same
channel - so the n-th battle of a channel is its n-th sub-round ("подраунд"). Extra time is a flag of the battle.

Finished battles are appended to DATA_DIR/rooms/<room>/battles.jsonl (one JSON line each, kept across restarts) and to
the LIVE log ("battle" lines). Nothing here plays or shows anything: it only listens."""

import json
import os
import time
from collections import deque

SAMPLE_SEC = 10                 # the score line gets a point at most this often
STALE_SEC = 600                 # a battle nobody reports on for this long is closed as unfinished
AFTER_END_SEC = 20              # the final score came but no "finish" event: close it after this
SERIES_GAP_SEC = 1800           # battles of one channel further apart than this are another series
SUPPORTERS_KEPT = 10
MEMORY = 2000                   # finished battles kept in memory (the file keeps all)
DURING = ("comments", "likes", "gifts", "coins", "follows", "subs", "joins")

RESULT = {"WIN": "win", "LOSE": "loss", "DRAW": "draw"}


class BattleTracker:
    def __init__(self, path, live=None, clock=time.time):
        self.path = path
        self.live = live                         # LiveLog: finished battles are written there as well
        self.clock = clock
        self.host_uid = ""                       # the host's numeric TikTok id (known at connect)
        self.current = None
        self.last_channel = {}                   # channel_id -> {"n": battles so far, "t": last battle's time}
        self.done = deque(maxlen=MEMORY)         # finished battles' summaries, oldest first
        self._load()

    # ---- persistence ----
    def _load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                for line in f:
                    try:
                        b = json.loads(line)
                    except ValueError:
                        continue
                    self.done.append(b)
                    ch = str(b.get("channel") or "")
                    if ch:
                        self.last_channel[ch] = {"n": b.get("round") or 1, "t": b.get("t1") or b.get("t0") or 0}
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"[battles] can't read the journal: {type(e).__name__}: {e}")

    def _append(self, summary):
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(summary, ensure_ascii=False) + "\n")
        except Exception as e:
            print(f"[battles] journal error: {type(e).__name__}: {e}")

    # ---- events ----
    def set_host(self, uid):
        self.host_uid = str(uid or "")

    def on_battle(self, info):
        action, status = info.get("action", ""), info.get("status", "")
        bid = info.get("battle_id") or 0
        if action == "OPEN" or (status == "BATTLE_STARTED" and action in ("", "LINK_MIC_BATTLE_BATTLE_ACTION_UNKNOWN")):
            self._begin(info)
        elif action in ("INVITE", "ACCEPT"):
            if self._same(bid):
                self._names(info)
            return
        elif action in ("FINISH", "LINK_MIC_BATTLE_BATTLE_ACTION_CUT_SHORT") or status in ("BATTLE_FINISHED", "BATTLE_PUNISH_STARTED"):
            if not self._same(bid):
                if not self.current:
                    return                      # a finish of a battle we never saw
                self._finish("unfinished")      # another battle started without a finish: close the old one
                self._begin(info)
            self._apply(info)
            self.current["cut"] = action != "FINISH" and action.endswith("CUT_SHORT") or None
            self._finish()
            return
        elif not self._same(bid):
            return
        if self.current:
            self._apply(info)

    def on_armies(self, info):
        bid = info.get("battle_id") or 0
        if not self._same(bid):
            if self.current:
                self._finish("unfinished")
            self._begin(info, mid=True)         # we connected in the middle of a battle
        self._apply(info)
        if info.get("reason") == "BATTLE_END" and self.current:
            self.current["ended"] = self.clock()

    def note(self, kind, n=1):
        """a comment / like / gift... on the host's stream while a battle is on"""
        if self.current and kind in DURING:
            d = self.current["during"]
            d[kind] = d.get(kind, 0) + n

    def tick(self):
        c = self.current
        if not c:
            return
        now = self.clock()
        if c.get("ended") and now - c["ended"] >= AFTER_END_SEC:
            self._finish()
        elif now - c["seen"] >= STALE_SEC:
            self._finish("unfinished")

    def reset(self):
        """a new LIVE: a battle left open belongs to the old one"""
        if self.current:
            self._finish("unfinished")
        self.last_channel.clear()

    # ---- internals ----
    def _same(self, bid):
        return bool(self.current) and (not bid or self.current["id"] == bid)

    def _begin(self, info, mid=False):
        if self.current:
            if self.current["id"] == info.get("battle_id"):
                return
            self._finish("unfinished")
        now = self.clock()
        ch = str(info.get("channel_id") or "")
        prev = self.last_channel.get(ch) if ch else None
        n = (prev["n"] + 1) if prev and now - prev["t"] < SERIES_GAP_SEC else 1
        start = (info.get("start_ms") or 0) / 1000 or now
        self.current = {"id": info.get("battle_id") or 0, "channel": ch, "round": n, "t0": round(start, 1), "t1": None,
                        "duration": info.get("duration") or 0, "extra": info.get("extra_sec") or 0,
                        "type": info.get("type") or "", "mid": mid or None, "sides": {}, "line": [], "support": {},
                        "during": {}, "result": "", "seen": now, "ended": None, "cut": None, "_last": 0}
        if ch:
            self.last_channel[ch] = {"n": n, "t": now}
        print(f"[battle] #{self.current['id']} round {n} of channel {ch or '?'}" + (" (joined midway)" if mid else ""))
        self._names(info)

    def _names(self, info):
        if not self.current:
            return
        for aid, a in (info.get("anchors") or {}).items():
            s = self.current["sides"].setdefault(aid, {"name": "", "handle": "", "score": 0})
            s["name"] = a.get("name") or s["name"]
            s["handle"] = a.get("handle") or s["handle"]

    def _apply(self, info):
        c = self.current
        c["seen"] = self.clock()
        c["duration"] = info.get("duration") or c["duration"]
        c["extra"] = max(c["extra"], info.get("extra_sec") or 0)
        self._names(info)
        for aid, score in (info.get("scores") or {}).items():
            s = c["sides"].setdefault(aid, {"name": "", "handle": "", "score": 0})
            s["score"] = score
        for aid, r in (info.get("results") or {}).items():
            s = c["sides"].setdefault(aid, {"name": "", "handle": "", "score": 0})
            s["result"] = RESULT.get(r.get("result"), "")
            if r.get("score"):
                s["score"] = r["score"]
        for aid, people in (info.get("supporters") or {}).items():
            box = c["support"].setdefault(aid, {})
            for p in people:
                if p.get("id") and p.get("score"):
                    box[p["id"]] = {"name": p.get("name") or box.get(p["id"], {}).get("name", ""), "score": p["score"]}
        now = self.clock()
        if info.get("scores") and now - c["_last"] >= SAMPLE_SEC:
            c["_last"] = now
            c["line"].append([round(now - c["t0"]), {a: s["score"] for a, s in c["sides"].items()}])
            del c["line"][:-400]

    def _ours(self, sides):
        """the host's side id; with an unknown host and two sides, none (the monitor shows A / B)"""
        if self.host_uid and self.host_uid in sides:
            return self.host_uid
        return ""

    def _finish(self, why=""):
        c, self.current = self.current, None
        if not c:
            return
        now = self.clock()
        c["t1"] = round(now, 1)
        ours = self._ours(c["sides"])
        outcome = why
        if ours and not why:
            outcome = c["sides"][ours].get("result", "")
            if not outcome:                                   # no result event: by points
                foes = [s["score"] for a, s in c["sides"].items() if a != ours]
                mine = c["sides"][ours]["score"]
                if foes and (mine or max(foes)):
                    outcome = "win" if mine > max(foes) else "loss" if mine < max(foes) else "draw"
        c["result"] = outcome or why or ""
        summary = self.summary(c, ours)
        summary["support"] = {a: sorted(({"id": i, **p} for i, p in box.items()), key=lambda p: -p["score"])[:SUPPORTERS_KEPT]
                              for a, box in c["support"].items()}
        summary["line"] = c["line"]
        self.done.append(summary)
        self._append(summary)
        if self.live:
            self.live.write("battle", id=c["id"], round=c["round"], result=summary["result"] or None,
                            ours=summary["ours"], theirs=summary["theirs"], duration=summary["duration"] or None,
                            extra=summary["extra"] or None, rival=summary["rival"] or None, during=c["during"] or None)
        print(f"[battle] #{c['id']} finished: {summary['result'] or '?'} {summary['ours']}:{summary['theirs']}")

    def summary(self, c, ours=None):
        ours = self._ours(c["sides"]) if ours is None else ours
        sides = c["sides"]
        mine = sides[ours]["score"] if ours else 0
        foes = [(a, s) for a, s in sides.items() if a != ours]
        rival = max(foes, key=lambda x: x[1]["score"])[1] if foes else None
        return {"id": c["id"], "channel": c["channel"], "round": c["round"], "t0": c["t0"], "t1": c["t1"],
                "duration": c["duration"], "extra": c["extra"], "type": c["type"], "mid": c["mid"], "cut": c["cut"],
                "result": c["result"], "ours": mine, "theirs": rival["score"] if rival else 0,
                "rival": (rival["name"] or rival["handle"]) if rival else "", "known": bool(ours),
                "sides": [{"id": a, **s, "host": a == ours} for a, s in sides.items()],
                "during": dict(c["during"])}

    # ---- for the panel ----
    def snapshot(self, recent=20):
        c = self.current
        cur = None
        if c:
            cur = self.summary(c)
            cur["elapsed"] = round(self.clock() - c["t0"])
            cur["support"] = {a: sorted(({"id": i, **p} for i, p in box.items()), key=lambda p: -p["score"])[:SUPPORTERS_KEPT]
                              for a, box in c["support"].items()}
            cur["line"] = c["line"]
        done = list(self.done)
        ch = (cur or (done[-1] if done else {})).get("channel")
        series = [b for b in done if ch and b.get("channel") == ch][-12:]
        if cur and series and series[-1].get("id") == cur["id"]:
            series = series[:-1]
        tot = {"battles": len(done)}
        for r in ("win", "loss", "draw"):
            tot[r] = sum(1 for b in done if b.get("result") == r)
        tot["points_for"] = sum(b.get("ours") or 0 for b in done)
        tot["points_against"] = sum(b.get("theirs") or 0 for b in done)
        return {"current": cur, "recent": list(reversed(done[-recent:])), "series": series, "totals": tot,
                "host": self.host_uid}
