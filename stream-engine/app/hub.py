"""Hub: owns the games, knows which one is active, routes TikTok events to it,
runs ticks/simulation, saves state and pushes updates to overlays."""

import asyncio
import json
import os
import random
import time
from collections import OrderedDict, deque

from . import config
from .games import GAMES
from .games.base import Viewer
from .reactions.balloons import LikeBalloons
from .room_prefs import GiftRules, Toasts, catalog
from .settings import GlobalSettings


class Hub:
    SESSION = "session.json"

    def __init__(self, store, username=None):
        self.store = store
        # the stream's own TikTok account (one hub = one streamer's room on the platform)
        self.username = (username or config.TIKTOK_USERNAME).lstrip("@").lower()
        self.games = {G.name: G(store) for G in GAMES}
        for g in self.games.values():
            g.host_id = self.username
        s = store.load(self.SESSION) or {}
        self.room_id = s.get("room_id") or (store.load("state.json") or {}).get("room_id")
        self.active = s.get("active") if s.get("active") in self.games else config.DEFAULT_GAME
        self.lang = s.get("lang") or config.LANGUAGE
        # per-game settings from the menu dialog: {game: {key: value}}
        self.global_settings = GlobalSettings()
        saved = s.get("options", {})
        self.global_settings.load(saved.pop("global", None))
        self.toasts = Toasts(saved.pop("toasts", None))           # each toast: show / voice / its speed
        self.gift_rules = GiftRules(saved.pop("gifts", None))     # which gift triggers which action
        if "break" in saved:                          # old single on/off switch for guess
            saved = {"guess": {"break": saved.pop("break")}, **saved}
        for name, opts in saved.items():
            if name in self.games and isinstance(opts, dict):
                for k, v in opts.items():
                    self.games[name].set_option(k, v)
        for g in self.games.values():
            g.set_lang(self.lang)
        self.clients = set()                      # websockets
        self.sent_seq = {name: g.seq for name, g in self.games.items()}
        self.tiktok_status = "offline"
        self.tg = None                                # TelegramLink when the bot is configured
        # stream feed (comments, gifts) for the menu page's alerts, independent of the game
        self.feed = deque(maxlen=100)
        self.feed_seq = 0
        self.feed_sent = 0
        self.greeted = set()                      # viewers already welcomed this stream
        self.names = {}                           # viewer id -> their TikTok nickname as of their last event
        self.recent = OrderedDict((u["id"], {k: u.get(k, "") for k in ("name", "avatar", "t")})
                                  for u in s.get("viewers") or [] if u.get("id"))   # this stream's viewers, latest last
        for g in self.games.values():
            g.names = self.names
        self.balloons = LikeBalloons(store, self.global_settings)   # like balloons fly over every page
        self.closed = False                       # set on shutdown: incoming events are ignored
        self.game.on_activate()

    @property
    def game(self):
        return self.games[self.active]

    def menu(self):
        return [{"name": g.name, "title": g.title, "options": g.OPTIONS, "values": g.get_options()}
                for g in self.games.values()]

    def set_active(self, name):
        if name not in self.games or name == self.active:
            return
        self.game.on_deactivate()
        self.active = name
        self.game.on_activate()
        self.game.dirty = True
        self.sent_seq[name] = self.game.seq           # don't replay events from before
        self.save_session()
        print(f"[hub] active game -> {name}")

    def set_lang(self, lang):
        if lang not in config.LANGUAGES or lang == self.lang:
            return
        self.lang = lang
        for g in self.games.values():
            g.set_lang(lang)
            g.dirty = True
        self.save_session()
        print(f"[hub] language -> {lang}")

    def save_session(self):
        self.store.save(self.SESSION, {"room_id": self.room_id, "active": self.active, "lang": self.lang,
                                       "options": self.options(),
                                       "viewers": [{"id": k, **u} for k, u in self.recent.items()]})

    def options(self):
        out = {n: g.get_options() for n, g in self.games.items() if g.OPTIONS}
        out["global"] = self.global_settings.values()
        out["toasts"] = self.toasts.values()
        out["gifts"] = self.gift_rules.values()
        return out

    def set_options(self, name, opts):
        if name in ("toasts", "gifts"):
            (self.toasts if name == "toasts" else self.gift_rules).set(opts)
            self._promos = None                       # the promo line follows the new rules at once
            self.save_session()
            self.game.dirty = True                    # pages get the new toast settings
            print(f"[hub] {name} -> {(self.toasts if name == 'toasts' else self.gift_rules).values()}")
            return
        if name == "global":
            for k, v in (opts or {}).items():
                self.global_settings.set(k, v)
            self.save_session()
            self.game.dirty = True                    # pages get the new voice rate etc.
            print(f"[hub] global settings -> {self.global_settings.values()}")
            return
        g = self.games.get(name)
        if not g:
            return
        for k, v in (opts or {}).items():
            if k in g.OPTIONS and v in g.OPTIONS[k]:
                g.set_option(k, v)
        g.dirty = True
        self.save_session()
        print(f"[hub] {name} settings -> {g.get_options()}")

    # ---- TikTok -> active game ----
    def new_live(self, room_id):
        if room_id and room_id != self.room_id:
            self.room_id = room_id
            for g in self.games.values():
                g.new_session()
            self.greeted = set()
            self.recent.clear()
            self.balloons.new_session()
            self.save_session()
            print(f"[hub] new LIVE (room {room_id}) -> all games reset")

    def _save_if_needed(self):
        """An important event (round start, winner, gift, hint...) was just handled: to disk now."""
        g = self.game
        if getattr(g, "save_now", False):
            g.save_now = False
            try:
                g.save()
            except Exception as e:
                print(f"[hub] save error ({g.name}):", e)

    def _feed(self, **e):
        # Deterministic plane trajectory (2026-10-26): the server picks dir / height / angle
        # ONCE per plane event, so the preview and the Studio overlay fly the same way.
        # Before this, plane.js rolled Math.random() on every client independently.
        if e.get("type") == "plane" and "dir" not in e:
            e["dir"] = random.choice([-1, 1])          # -1: right -> left, 1: left -> right
            e["y_frac"] = round(random.uniform(0.12, 0.45) if e.get("bomber")
                                else random.uniform(0.2, 0.8), 3)
            e["deg"] = round(random.uniform(-15, 15), 1)
        if e.get("type") in ("snowball", "cake") and "seed" not in e:
            e["seed"] = random.randrange(1, 2 ** 31)      # where it hits and how it bursts: the same on every page
        self.feed_seq += 1
        e.update(seq=self.feed_seq, t=time.time())
        self.feed.append(e)

    def _seen(self, v):
        """nicknames change: every event carries the current one; the stream's viewers, latest first (the room
        page picks one to act for)"""
        if v.id and v.name:
            self.names[v.id.lower()] = v.name
            r = self.recent.pop(v.id, None) or {}
            self.recent[v.id] = {"name": v.name, "avatar": v.avatar or r.get("avatar", ""), "t": time.time()}
            while len(self.recent) > 500:
                self.recent.pop(next(iter(self.recent)))

    def viewers(self, limit=300):
        """[{id, name, avatar}] the stream's viewers, the latest active first"""
        return [{"id": k, "name": u["name"], "avatar": u["avatar"]}
                for k, u in reversed(list(self.recent.items()))][:limit]

    def manual_action(self, action, viewer_id):
        """The streamer acts for a viewer from the room page, as if their gift came: a hint, 3 words, the boost,
        steal the win, a balloon, a plane, butterflies, a snowball, the cake."""
        u = self.recent.get(viewer_id)
        if not u:
            return False
        v = Viewer(viewer_id, u["name"], u["avatar"], 1)
        print(f"[manual] {u['name']}: {action}")
        if action in self.ANIMATIONS:
            self._gift_animations(v, "", {action}, 1)
            return True
        ok = bool(getattr(self.game, "manual_action", None)) and self.game.manual_action(v, action)
        self._save_if_needed()
        return ok

    def comment(self, v: Viewer, text, ts=None):
        if self.closed:                               # shutting down: nothing changes any more
            return
        self._seen(v)
        self._feed(type="chat", name=v.name, avatar=v.avatar, text=text[:200], sent=ts,
                   host=v.id.lower() == self.username)
        if self.tg and self.tg.on_comment(v, text):  # "настроить связь" / a Telegram key: not a guess
            return
        self.game.on_comment(v, text, ts)
        self._save_if_needed()

    def join(self, v: Viewer):
        if self.closed:                               # shutting down: nothing changes any more
            return
        self._seen(v)
        # welcome each viewer once per stream (pages throttle and merge the greetings)
        if self.global_settings.get("GREET_JOINS") and v.id not in self.greeted and v.id.lower() != self.username:
            if len(self.greeted) > 20000:
                self.greeted.clear()
            self.greeted.add(v.id)
            self._feed(type="join", name=v.name, avatar=v.avatar)
        self.game.on_join(v)

    def gift(self, v: Viewer, gift, count, to="", repeat=False, coins=0, image=""):
        """A gift on the stream. Only gifts to the host count in the game (hints); a gift to a guest
        or co-host on the same live is just shown. repeat: more gifts of a combo already announced;
        coins: the gift's price (TikTok's diamond count) for the "from N coins" rules."""
        if self.closed:                               # shutting down: nothing changes any more
            return
        self._seen(v)
        catalog().record(gift, coins, image)
        if not repeat:
            self._feed(type="gift", name=v.name, avatar=v.avatar, gift=gift, count=count, to=to)
        self._journal_gift(v, gift, count, to)
        if to and to.lower() != self.username:
            print(f"[gift] {v.name}: {gift} went to @{to}, not to the host -> no game action")
            return
        actions = self.gift_rules.actions_for(gift, coins)
        self._gift_animations(v, gift, actions, count)
        self.game.on_gift(v, gift, count, repeat=repeat, actions=actions)
        self._save_if_needed()

    GIFT_ANIMATIONS_MAX = 50                          # one batch of a combo: a sane upper bound (the feed keeps 100)

    PROMO_ORDER = ["hint", "cake", "bomber", "multi", "boost", "steal", "snowball", "balloon", "plane"]
    ANIMATIONS = {"balloon", "plane", "bomber", "snowball", "cake"}   # gift actions the hub shows itself, on every page

    def gift_promos(self):
        """What the stream's gifts do, for the promo line above the bot's name (TT mode): one item per action
        that has a gift - {action, rule, gift, ru, coins, images}; "from N coins" and "any" show 2-3 popular
        gifts. Rebuilt at most every 30 s."""
        now = time.time()
        if getattr(self, "_promos", None) is not None and now - self._promos_t < 30:
            return self._promos
        gifts = catalog().list()                     # most sent first
        by_name = {g["name"]: g for g in gifts}
        tiers = [5, 10, 30, 100]
        out = []
        for action in self.PROMO_ORDER:
            rule = self.gift_rules.values().get(action, "")
            if not rule:
                continue
            item = {"action": action, "rule": rule, "gift": "", "ru": "", "coins": 0, "images": []}
            if rule.startswith("gift:"):
                g = by_name.get(rule[5:], {"name": rule[5:]})
                item.update(gift=g["name"], ru=g.get("ru", ""), coins=g.get("coins", 0),
                            images=[g["image"]] if g.get("image") else [])
            else:
                lo = int(rule[4:]) if rule.startswith("min:") else 0
                hi = next((t for t in tiers if t > lo), 10 ** 9) if lo else 10 ** 9
                item["coins"] = lo
                item["images"] = [g["image"] for g in gifts if g.get("image") and lo <= g["coins"] < hi][:3]
            out.append(item)
        self._promos, self._promos_t = out, now
        return out

    def _gift_animations(self, v, gift, actions, count):
        """Balloon / plane / butterfly plane / big snowball for a gift bound to them (the streamer's gift rules),
        on every page: one per gift, no pause - 10 gifts = 10 planes (combo parts included). The cake is a show of
        its own (up to 100 s, the chat fires its crackers with "огонь"): one per gift batch, the pages queue them."""
        anim = actions & self.ANIMATIONS
        if not anim:
            return
        n = max(1, min(int(count or 1), self.GIFT_ANIMATIONS_MAX))
        total = self.balloons.total_of(v.id)
        for _ in range(n):
            if "balloon" in anim:
                self._feed(type="balloon", id=v.id, name=v.name, avatar=v.avatar, n=0, total=total, per=0, gift=gift)
            if "plane" in anim or "bomber" in anim:
                self._feed(type="plane", id=v.id, name=v.name, avatar=v.avatar, total=total, auto=True,
                           bomber="bomber" in anim, gift=gift)
            if "snowball" in anim:
                self._feed(type="snowball", id=v.id, name=v.name, avatar=v.avatar, total=total, big=True, gift=gift)
        if "cake" in anim:
            self._feed(type="cake", id=v.id, name=v.name, avatar=v.avatar, gift=gift)
        print(f"[gift] {v.name}: {gift} x{n} -> {sorted(anim)}")

    def _journal_gift(self, v, gift, count, to):
        """Every gift, one JSON line in data/gifts.jsonl (kept across rebuilds: the data folder is mounted)."""
        try:
            line = json.dumps({"t": int(time.time()), "time": time.strftime("%Y-%m-%d %H:%M:%S"), "id": v.id,
                               "name": v.name, "gift": gift, "count": count, "to": to or None,
                               "game": self.active}, ensure_ascii=False)
            with open(self.store.path("gifts.jsonl"), "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception as e:
            print(f"[gift] journal error: {e}")

    def follow(self, v: Viewer):
        if self.closed:                               # shutting down: nothing changes any more
            return
        self._seen(v)
        self.game.on_follow(v)

    def like(self, v: Viewer, count):
        if self.closed:                               # shutting down: nothing changes any more
            return
        self._seen(v)
        before = self.balloons.total_of(v.id)
        for b in self.balloons.on_like(v, count):  # 100 likes -> lift off, on whatever page is open
            self._feed(type="balloon", **b)
        plane = self.balloons.auto_plane(v, before)  # every PLANE_AUTO_LIKES likes -> the plane flies by itself
        if plane:
            print(f"[plane] {v.name}: {plane['total']} likes -> auto plane")
            self._feed(type="plane", **plane)
        snow = self.balloons.auto_snowball(v, before)  # every SNOWBALL_LIKES likes -> a snowball at the streamer
        if snow:
            print(f"[snowball] {v.name}: {snow['total']} likes -> snowball")
            self._feed(type="snowball", **snow)
        cake = self.balloons.auto_cake(v, before)      # every CAKE_LIKES likes -> the cake show for them
        if cake:
            print(f"[cake] {v.name}: {cake['total']} likes -> cake")
            self._feed(type="cake", **cake)
        self.game.on_like(v, count)

    # ---- state for overlays ----
    def message(self, name, since=None, feed_since=None):
        g = self.games[name]
        return {"active": self.active, "game": name, "seq": g.seq, "now": time.time(),
                "feedSeq": self.feed_seq,
                "feed": [e for e in self.feed if e["seq"] > feed_since] if feed_since is not None else [],
                "tiktok": self.tiktok_status, "tgBot": self.tg.bot if self.tg and self.tg.word else "",
                "version": getattr(self, "web_version", ""),
                "lang": self.lang, "voiceRate": self.global_settings.get("VOICE_RATE"),
                "toasts": self.toasts.values(),
                "giftPromos": self.gift_promos(),
                "voiceVolume": self.global_settings.get("VOICE_VOLUME"), "fxVolume": self.global_settings.get("FX_VOLUME"),
                "events": g.events_since(since) if since is not None else [],
                "balloons": self.balloons.snapshot(),
                "state": g.snapshot()}

    # ---- background loops ----
    async def ticker(self):
        while True:
            try:
                self.game.tick(time.time())
                self._save_if_needed()
                self.balloons.tick(time.time())
            except Exception as e:
                print("[hub] tick error:", type(e).__name__, e)
            await asyncio.sleep(0.25)

    async def saver(self):
        while True:
            await asyncio.sleep(1)
            for g in self.games.values():
                try:
                    g.save()
                except Exception as e:
                    print(f"[hub] save error ({g.name}):", e)
            self.balloons.save()
            self.save_session()
            catalog().flush()

    async def broadcaster(self):
        """Push the active game's state + new events to websocket clients (<=10/s)."""
        while True:
            await asyncio.sleep(0.1)
            g = self.game
            feed_new = self.feed_seq != self.feed_sent or self.balloons.dirty
            if not (g.dirty or feed_new) or not self.clients:
                g.dirty = self.balloons.dirty = False
                self.sent_seq[g.name] = g.seq
                self.feed_sent = self.feed_seq
                continue
            g.dirty = self.balloons.dirty = False
            msg = json.dumps(self.message(g.name, self.sent_seq[g.name], self.feed_sent), ensure_ascii=False)
            self.sent_seq[g.name] = g.seq
            self.feed_sent = self.feed_seq
            for ws in list(self.clients):
                try:
                    await ws.send_text(msg)
                except Exception:
                    self.clients.discard(ws)

    async def simulator(self):
        print("[sim] fake viewers are playing (no TikTok needed)")
        while True:
            try:
                delay = self.game.simulate_step()
                if random.random() < 0.25:            # fake likes -> balloons on every page
                    n = random.choice(["Alex", "Mike", "Sarah", "Emma"])
                    self.like(Viewer(n.lower(), n, ""), random.choice([3, 5, 8, 15]))
            except Exception as e:
                print("[sim] error:", type(e).__name__, e)
                delay = 1
            await asyncio.sleep(delay)
