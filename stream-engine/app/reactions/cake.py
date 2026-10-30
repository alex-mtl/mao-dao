"""The cake show's clock lives here, not in the pages (2026-10-30): the server decides when the fuses are lit,
when each of the 100 crackers takes off (one a second, and one at once for every "огонь" in the chat) and when the
finale comes; the pages (common/cake.js) only draw it. So every page shows the same show, and the LIVE log gets
the moments the digest needs: the show's start, the last cracker's take-off and the moment the cake flies apart.

Feed events (to the pages): cake {seed, name, avatar, lit, server: true} when the show starts (one at a time, the
next ones wait), cake_fire {seed, name} per cracker, cake_final {seed} when the cake turns its top to us.
LIVE log: cake_start {seed}, cake_last {seed}, cake_split {seed}. The numbers follow common/cake.js."""

import random

LIT = 10.0          # s after the start: the crackers have been poured and stuck in (cake.js: tiers, box, pour)
FIRST = 1.8         # the first take-off after the fuses are lit
GAP = 1.0           # then one a second
CRACKERS = 100
FLIGHT = 2.2        # a cracker's longest flight before it bursts
TO_FINAL = 1.0      # all burst -> the cake starts turning
TO_SPLIT = 2.7      # turn 1.2 s + the avatar shown 1.5 s -> the slices fly
TO_END = 4.0        # + 1.3 s of flying slices
SPACING = 0.12      # crackers asked for by the chat before the first take-off go this far apart
QUEUE = 3           # cakes waiting while one plays
WORDS = ("огонь", "fire", "feu", "fuego")


class CakeShows:
    def __init__(self, feed, log):
        self.feed, self.log = feed, log            # feed(**event) to the pages, log(kind, **fields) to the LIVE log
        self.cur, self.queue = None, []

    def add(self, e):
        """a cake for a viewer (likes or a gift): {id, name, avatar, ...}; returns its seed (log lines name it)"""
        seed = random.randrange(1, 2 ** 31)
        if self.cur and len(self.queue) >= QUEUE:
            return seed                            # as before: more than QUEUE waiting are not shown
        self.queue.append(dict(e, seed=seed))
        return seed

    def comment(self, name, text):
        c = self.cur
        if not c or not c["left"] or c["final"] is not None:
            return False
        t = (text or "").lower().replace("ё", "е")
        if not any(w in t for w in WORDS):
            return False
        if c["next"] is None:                      # not lit yet: they go first once the fuses burn
            if len(c["waiting"]) < c["left"]:
                c["waiting"].append(name)
            return True
        return self._fire(name, c["now"])

    def tick(self, now):
        if not self.cur and self.queue:
            e = self.queue.pop(0)
            self.cur = {"seed": e["seed"], "lit": now + LIT, "next": None, "wait_at": 0, "left": CRACKERS,
                        "waiting": [], "last": None, "final": None, "split": False, "now": now}
            self.feed(**e, type="cake", lit=round(now + LIT, 3), server=True)
            self.log("cake_start", seed=e["seed"])
        c = self.cur
        if not c:
            return
        c["now"] = now
        if c["next"] is None and now >= c["lit"] + FIRST:
            c["next"] = c["wait_at"] = c["lit"] + FIRST
        while c["left"] and c["next"] is not None and now >= c["next"]:
            self._fire(None, now)
            c["next"] += GAP
        while c["left"] and c["waiting"] and c["next"] is not None and now >= c["wait_at"]:
            self._fire(c["waiting"].pop(0), now)
            c["wait_at"] += SPACING                    # SPACING apart, also when a tick (.25 s) covers several
        if not c["left"] and c["final"] is None and now >= c["last"] + FLIGHT + TO_FINAL:
            c["final"] = now
            self.feed(type="cake_final", seed=c["seed"])
        if c["final"] is not None and not c["split"] and now >= c["final"] + TO_SPLIT:
            c["split"] = True
            self.log("cake_split", seed=c["seed"])
        if c["final"] is not None and now >= c["final"] + TO_END:
            self.cur = None

    def _fire(self, name, now):
        c = self.cur
        if not c["left"]:
            return False
        c["left"] -= 1
        self.feed(type="cake_fire", seed=c["seed"], name=name or "")
        if not c["left"]:
            c["last"] = now
            self.log("cake_last", seed=c["seed"])
        return True

    def reset(self):
        self.cur, self.queue = None, []
