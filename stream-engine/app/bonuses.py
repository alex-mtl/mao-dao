"""Viewers' bonuses "on account" in a room: hints, cakes, boosts... (docs/games/guessword.md, "Players' bonuses").

The platform (Laravel, table guessword_bonuses) is the source of truth; the engine keeps a copy to answer at once
in the chat ("подсказка", a club emote) and sends every change it makes as an operation with an id:

  engine -> Laravel  POST {PLATFORM_URL}/internal/guessword/bonuses {room, ops: [{op, viewer, kind, delta, source, name}]}
                     -> {balances: {viewer: {kind: n}}} of the viewers touched (applied once per op id)
  engine -> Laravel  GET  {PLATFORM_URL}/internal/guessword/bonuses?room=gw1 -> {balances} (on start, every PULL_SEC)
  Laravel -> engine  POST /internal/rooms/{id}/bonuses {id, balances: {kind: n}} (the host changed them on the panel)

Operations not yet accepted wait in the room's bonus_outbox.json (kept across restarts) and are counted on top of
whatever Laravel says. Without PLATFORM_URL (a home copy, tests) the copy here is all there is."""

import asyncio
import secrets
import time

from . import config

# what a bonus can be: a gift action the viewer launches from their account (room_prefs.GIFT_ACTIONS)
KINDS = ["hint", "cake", "boost", "multi", "balloon", "plane", "bomber", "snowball"]
FLUSH_SEC = 2
PULL_SEC = 600


def account_id(viewer_id):
    return (viewer_id or "").strip().lstrip("@").lower()


class BonusAccounts:
    FILE = "bonuses.json"                 # {viewer: {kind: n}} (n > 0 only)
    OUTBOX = "bonus_outbox.json"          # operations Laravel hasn't confirmed yet
    OLD_CREDITS = "guess/hint_credits.json"   # before the bonuses: hints only
    MIGRATED = "bonus_migrated.json"      # this copy's balances went to Laravel once

    def __init__(self, store):
        self.store = store
        self.bal = {}
        saved = store.load(self.FILE, None)
        if saved is None:                 # before the bonuses: hints only, in the guess game's file
            saved = {k: {"hint": v} for k, v in (store.load(self.OLD_CREDITS, {}) or {}).items()}
        for viewer, kinds in (saved or {}).items():
            for kind, n in (kinds or {}).items():
                self._put(account_id(viewer), kind, self.get(viewer, kind) + int(n))
        self.outbox = list(store.load(self.OUTBOX, []) or [])

    # ---- reading
    def get(self, viewer, kind):
        return self.bal.get(account_id(viewer), {}).get(kind, 0)

    def of_kind(self, kind):
        """{viewer: n} of everyone with this bonus"""
        return {v: k[kind] for v, k in self.bal.items() if k.get(kind, 0) > 0}

    def of(self, viewer):
        return dict(self.bal.get(account_id(viewer), {}))

    # ---- changing
    def _put(self, viewer, kind, n):
        if not viewer or kind not in KINDS:
            return
        if n > 0:
            self.bal.setdefault(viewer, {})[kind] = n
        elif viewer in self.bal:
            self.bal[viewer].pop(kind, None)
            if not self.bal[viewer]:
                del self.bal[viewer]

    def add(self, viewer, kind, delta, source="engine", name=""):
        """+/- on the account (never below 0); the change goes to Laravel. -> the balance now"""
        viewer, delta = account_id(viewer), int(delta)
        if not viewer or kind not in KINDS or not delta:
            return self.get(viewer, kind)
        before = self.get(viewer, kind)
        self._put(viewer, kind, max(0, before + delta))
        real = self.get(viewer, kind) - before
        if real and config.PLATFORM_URL:
            self.outbox.append({"op": secrets.token_hex(8), "viewer": viewer, "kind": kind, "delta": real,
                                "source": source, "name": (name or "")[:100], "t": int(time.time())})
            self.store.save(self.OUTBOX, self.outbox)
        self.save()
        return self.get(viewer, kind)

    def rename(self, old, new):
        """one viewer, two ids (identities): what `old` has moves to `new`"""
        old, new = account_id(old), account_id(new)
        if old == new or old not in self.bal:
            return
        for kind, n in list(self.bal[old].items()):
            self.add(old, kind, -n, "rename")
            self.add(new, kind, n, "rename")

    def set_viewer(self, viewer, balances):
        """the balances Laravel has for this viewer, plus our operations it hasn't seen yet"""
        viewer = account_id(viewer)
        self.bal.pop(viewer, None)
        for kind, n in (balances or {}).items():
            self._put(viewer, kind, int(n))
        for o in self.outbox:
            if o["viewer"] == viewer:
                self._put(viewer, o["kind"], max(0, self.get(viewer, o["kind"]) + int(o["delta"])))
        self.save()

    def set_all(self, balances):
        for viewer in set(self.bal) | {account_id(v) for v in balances}:
            self.set_viewer(viewer, next((b for v, b in balances.items() if account_id(v) == viewer), {}))

    def save(self):
        self.store.save(self.FILE, self.bal)

    # ---- sync with Laravel
    def migrate_ops(self, room_id):
        """first sync: what this copy has (the old hint file included) goes to Laravel once; the op ids are
        fixed, so a repeat is a no-op there"""
        if self.store.load(self.MIGRATED) or not config.PLATFORM_URL:
            return
        known = {o["op"] for o in self.outbox}
        for viewer, kinds in self.bal.items():
            for kind, n in kinds.items():
                pending = sum(int(o["delta"]) for o in self.outbox if o["viewer"] == viewer and o["kind"] == kind)
                op = f"migrate-{room_id}-{kind}-{viewer}"
                if n - pending > 0 and op not in known:
                    self.outbox.append({"op": op, "viewer": viewer, "kind": kind, "delta": n - pending,
                                        "source": "migration", "name": "", "t": int(time.time())})
        self.store.save(self.OUTBOX, self.outbox)


class BonusSync:
    """the room's loop: pull everything on start (and every PULL_SEC), push our operations every FLUSH_SEC"""

    def __init__(self, accounts, room_id):
        self.acc, self.room_id = accounts, room_id
        self.pulled_t = 0.0

    async def api(self, method, body=None):
        import httpx
        url = config.PLATFORM_URL.rstrip("/") + "/internal/guessword/bonuses"
        headers = {"X-Internal-Secret": config.INTERNAL_SECRET, "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await (c.get(url, params={"room": self.room_id}, headers=headers) if method == "GET"
                           else c.post(url, json=body, headers=headers))
                if r.status_code == 200:
                    return r.json()
                print(f"[bonuses] {method} -> HTTP {r.status_code}")
        except Exception as e:
            print(f"[bonuses] {method} error: {type(e).__name__}")
        return None

    async def pull(self):
        r = await self.api("GET")
        if r is None or not isinstance(r.get("balances"), dict):
            return False
        if not self.acc.store.load(self.acc.MIGRATED):
            self.acc.migrate_ops(self.room_id)
        self.acc.set_all(r["balances"])
        self.pulled_t = time.time()
        return True

    async def flush(self):
        ops = list(self.acc.outbox)
        if not ops:
            return True
        r = await self.api("POST", {"room": self.room_id, "ops": ops})
        if r is None or not isinstance(r.get("balances"), dict):
            return False
        sent = {o["op"] for o in ops}
        self.acc.outbox = [o for o in self.acc.outbox if o["op"] not in sent]
        self.acc.store.save(self.acc.OUTBOX, self.acc.outbox)
        if any(o["source"] == "migration" for o in ops):
            self.acc.store.save(self.acc.MIGRATED, {"t": int(time.time())})
        for viewer, b in r["balances"].items():
            self.acc.set_viewer(viewer, b)
        return True

    async def run(self):
        if not config.PLATFORM_URL or not config.INTERNAL_SECRET:
            return
        while True:
            if time.time() - self.pulled_t > PULL_SEC:
                await self.pull()
            if self.pulled_t:                    # nothing goes out before Laravel's balances came
                await self.flush()
            await asyncio.sleep(FLUSH_SEC)
