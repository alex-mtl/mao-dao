"""Statistics of the current LIVE for the "Listen" mode: counters, the most active viewers, a per-minute line.
Always collected (cheap), whatever mode is active; the panel shows them in the Listen monitor.
Kept in DATA_DIR/rooms/<room>/listen.json, reset when a new LIVE starts."""

import time

TOP = 10
KEEP_MINUTES = 360
VIEWERS_MAX = 50000
KINDS = ("comments", "likes", "gifts", "coins", "follows", "subs", "joins", "shares")


class ListenStats:
    FILE = "listen.json"

    def __init__(self, store, clock=time.time):
        self.store = store
        self.clock = clock
        self.reset()
        saved = store.load(self.FILE) or {}
        if saved.get("started"):
            self.started = saved["started"]
            self.totals.update({k: saved.get("totals", {}).get(k, 0) for k in KINDS})
            self.people = saved.get("people") or {}
            self.minutes = {int(k): v for k, v in (saved.get("minutes") or {}).items()}
            self.viewers = set(saved.get("viewers") or [])
            self.gift_names = saved.get("gift_names") or {}

    def reset(self):
        self.started = self.clock()
        self.totals = {k: 0 for k in KINDS}
        self.people = {}          # viewer id -> {name, comments, likes, gifts, coins, follow, sub}
        self.minutes = {}         # minutes since the start -> {kind: n}
        self.viewers = set()
        self.gift_names = {}      # gift name -> {n, coins}

    def _person(self, v):
        p = self.people.get(v.id)
        if p is None:
            if len(self.people) >= VIEWERS_MAX:
                return {}
            p = self.people[v.id] = {"name": v.name, "comments": 0, "likes": 0, "gifts": 0, "coins": 0}
        p["name"] = v.name or p["name"]
        return p

    def _add(self, kind, n=1):
        self.totals[kind] += n
        m = int((self.clock() - self.started) // 60)
        row = self.minutes.setdefault(m, {})
        row[kind] = row.get(kind, 0) + n
        if len(self.minutes) > KEEP_MINUTES:
            for old in sorted(self.minutes)[:len(self.minutes) - KEEP_MINUTES]:
                del self.minutes[old]

    def seen(self, v):
        if v.id and len(self.viewers) < VIEWERS_MAX:
            self.viewers.add(v.id)

    def comment(self, v):
        self.seen(v)
        self._add("comments")
        if v.id:
            p = self._person(v)
            p["comments"] = p.get("comments", 0) + 1

    def like(self, v, n):
        self.seen(v)
        self._add("likes", n)
        if v.id:
            p = self._person(v)
            p["likes"] = p.get("likes", 0) + n

    def gift(self, v, gift, count, coins):
        self.seen(v)
        total = (coins or 0) * count
        self._add("gifts", count)
        self._add("coins", total)
        g = self.gift_names.setdefault(gift, {"n": 0, "coins": 0})
        g["n"] += count
        g["coins"] += total
        if v.id:
            p = self._person(v)
            p["gifts"] = p.get("gifts", 0) + count
            p["coins"] = p.get("coins", 0) + total

    def follow(self, v):
        self.seen(v)
        self._add("follows")
        if v.id:
            self._person(v)["follow"] = 1

    def sub(self, v):
        self.seen(v)
        self._add("subs")
        if v.id:
            self._person(v)["sub"] = 1

    def join(self, v):
        self.seen(v)
        self._add("joins")

    def share(self, v):
        self.seen(v)
        self._add("shares")

    def save(self):
        self.store.save(self.FILE, {"started": self.started, "totals": self.totals, "people": self.people,
                                    "minutes": self.minutes, "viewers": sorted(self.viewers),
                                    "gift_names": self.gift_names})

    def snapshot(self):
        def top(key, limit=TOP):
            rows = [(i, p) for i, p in self.people.items() if p.get(key)]
            rows.sort(key=lambda r: -r[1][key])
            return [{"id": i, "name": p["name"], "n": p[key]} for i, p in rows[:limit]]

        now_min = int((self.clock() - self.started) // 60)
        line = [dict(m=m, **self.minutes.get(m, {})) for m in range(max(0, now_min - 59), now_min + 1)]
        gifts = sorted(({"gift": k, **v} for k, v in self.gift_names.items()), key=lambda g: -g["coins"])[:TOP]
        return {"started": self.started, "totals": dict(self.totals, viewers=len(self.viewers)),
                "top": {"coins": top("coins"), "likes": top("likes"), "comments": top("comments")},
                "gifts": gifts, "line": line}
