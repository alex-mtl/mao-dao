"""A room's presentation and gift settings, set on the platform's room page:

- Toasts: each toast / voice line of the pages can be hidden, silenced, and said at its own speed.
- GiftRules: which gift triggers which action (a hint, 3 words, a balloon, a plane...).
- GiftCatalog: every gift seen on any stream of the platform (name -> coins), for the page's selectors.

Hub-level (shared by the room's games); kept in the hub's session file with the other options."""

import json
import os
import time

from . import config

# toast / voice line ids the pages know -> default speech rate (1 = key phrases said at normal speed,
# None = the room's voice rate). Battle lines start with "b_"; greet / balloon / plane are on every page.
TOASTS = {
    "leader": None, "jump": None, "so_close": None, "top": None, "streak": None, "hint": None,
    "gift": None, "hint_wait": None, "thanks": 1, "follow_needed": 1, "found_pending": 1, "dq": 1,
    "winner": 1, "time_up": None, "round": 1, "break": 1, "custom_word": None, "tg_word": None,
    "tg_linked": None, "greet": None, "balloon": None, "plane": None,
    "b_score": None, "b_lead": None, "b_win": 1, "b_round": 1, "b_sum": None,
}
RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]
# a toast's in / out animation: the fastest it gets when the chat is busy (s; calm - smooth 0.5 s);
# "auto" = down to 0.1 s
ANIMS = [0, 0.1, 0.2, 0.35, 0.5, "auto"]


class Toasts:
    """Only what differs from the defaults is kept: {id: {"show": 0/1, "voice": 0/1, "rate": x, "anim": s|"auto"}}."""

    def __init__(self, values=None):
        self._v = {}
        self.set(values or {})

    def set(self, values):
        for tid, v in (values or {}).items():
            if tid not in TOASTS or not isinstance(v, dict):
                continue
            cur = dict(self._v.get(tid, {}))
            for k in ("show", "voice"):
                if k in v:
                    cur[k] = 1 if v[k] else 0
            if "anim" in v:
                if v["anim"] in ANIMS:
                    cur["anim"] = v["anim"]
                elif v["anim"] is None:
                    cur.pop("anim", None)
            if "rate" in v:
                if v["rate"] in RATES:
                    cur["rate"] = v["rate"]
                elif v["rate"] is None:
                    cur.pop("rate", None)
            self._v[tid] = cur

    def values(self):
        return {tid: dict(v) for tid, v in self._v.items() if v}

    def schema(self):
        return {"ids": TOASTS, "rates": RATES, "anims": ANIMS}


# actions a gift can trigger; the hub runs the animations, the game the game actions
GIFT_ACTIONS = ["hint", "multi", "balloon", "plane", "bomber"]
GIFT_MIN_COINS = [5, 10, 30, 100]


class GiftRules:
    """{action: rule}: "" (no gift), "any", "min:<coins>", "gift:<name>". Default: any gift gives a hint."""
    DEFAULT = {"hint": "any"}

    def __init__(self, values=None):
        self._v = dict(self.DEFAULT)
        self.set(values or {})

    def set(self, values):
        for action, rule in (values or {}).items():
            if action not in GIFT_ACTIONS or not isinstance(rule, str):
                continue
            if rule in ("", "any") or (rule.startswith("gift:") and len(rule) > 5) \
                    or (rule.startswith("min:") and rule[4:].isdigit() and int(rule[4:]) in GIFT_MIN_COINS):
                self._v[action] = rule

    def values(self):
        return dict(self._v)

    def actions_for(self, gift, coins):
        """The actions this gift triggers. A gift bound to an action (by its name or "from N coins") does
        that; "any gift" covers only the gifts not bound to anything else - a rose bound to the balloon
        launches the balloon and gives no hint."""
        name, coins = (gift or "").lower(), int(coins or 0)
        bound = {action for action, rule in self._v.items()
                 if (rule.startswith("min:") and coins >= int(rule[4:]))
                 or (rule.startswith("gift:") and rule[5:].lower() == name)}
        if bound:
            return bound
        return {action for action, rule in self._v.items() if rule == "any"}


def _load_ru():
    """gifts_ru.tsv: English name -> (Russian name, theme) - TikTok gives neither (hand-made list)"""
    out = {}
    try:
        with open(os.path.join(os.path.dirname(__file__), "gifts_ru.tsv"), encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) == 3 and parts[0].strip():
                    out[parts[0].strip()] = (parts[1], parts[2])
    except OSError:
        pass
    return out


RU = _load_ru()


class GiftCatalog:
    """Every TikTok gift, shared by all rooms: {name: {"coins", "image", "seen", "audio", "combo"}} - the full list comes from
    TikTok once a day (refresh_from_tiktok), "seen" counts the gifts sent on the platform's streams (the most
    popular go first in the room page's selectors). Saved when something new comes, the counts at most once a
    minute."""
    REFRESH_SEC = 24 * 3600
    SAVE_EVERY = 60

    def __init__(self, path=None):
        self.path = path or os.path.join(config.DATA_DIR, "gifts_seen.json")
        self.gifts = {}
        self.refreshed_at = 0.0
        self.backfilled = False
        try:
            with open(self.path, encoding="utf-8") as f:
                d = json.load(f)
            self.refreshed_at = float(d.pop("_refreshed_at", 0) or 0) if isinstance(d, dict) else 0.0
            self.backfilled = bool(d.pop("_backfilled", False))
            for name, v in (d or {}).items():                # old files: {name: coins}
                self.gifts[name] = v if isinstance(v, dict) else {"coins": int(v or 0), "image": "", "seen": 0}
        except (OSError, ValueError):
            pass
        self.saved_at = 0.0
        self.dirty = False
        if not getattr(self, "backfilled", False):
            self.backfill(os.path.join(os.path.dirname(self.path), "rooms"))

    def backfill(self, rooms_dir):
        """once: "seen" from every room's gift journal (rooms/*/gifts*.jsonl), the gifts sent before the counter"""
        import glob
        counts = {}
        for path in glob.glob(os.path.join(rooms_dir, "*", "gifts*.jsonl")):
            try:
                with open(path, encoding="utf-8") as f:
                    for line in f:
                        try:
                            g = json.loads(line)
                        except ValueError:
                            continue
                        if g.get("gift") and not g.get("to"):
                            counts[g["gift"]] = counts.get(g["gift"], 0) + int(g.get("count") or 1)
            except OSError:
                continue
        for name, n in counts.items():
            e = self._entry(name)
            e["seen"] = max(e.get("seen", 0), n)
        self.backfilled = True
        self.save()
        print(f"[gifts] catalog: sent counts from the journals ({len(counts)} gifts)")

    def _entry(self, name):
        return self.gifts.setdefault(name, {"coins": 0, "image": "", "seen": 0})

    def record(self, name, coins, image=""):
        """a gift sent on a stream"""
        if not name:
            return
        g = self._entry(name)
        new = not g["seen"] and not g["coins"]
        g["seen"] = g.get("seen", 0) + 1
        if coins and g["coins"] != int(coins):
            g["coins"], new = int(coins), True
        if image and not g.get("image"):
            g["image"], new = image, True
        self.dirty = True
        if new or time.time() - self.saved_at > self.SAVE_EVERY:
            self.save()

    def flush(self):
        """the counts of gifts sent, at most once a minute (the hub's saver calls it)"""
        if self.dirty and time.time() - self.saved_at > self.SAVE_EVERY:
            self.save()

    def needs_refresh(self):
        return time.time() - self.refreshed_at > self.REFRESH_SEC

    def refresh_from_tiktok(self, gifts):
        """TikTok's gift list ([{name, diamond_count, image: {url_list}}]): prices and images of every gift"""
        n = 0
        for t in gifts or []:
            name = (t.get("name") or "").strip()
            if not name:
                continue
            g = self._entry(name)
            g["coins"] = int(t.get("diamond_count") or g["coins"] or 0)
            urls = (t.get("image") or {}).get("url_list") or []
            if urls:
                g["image"] = urls[0]
            g["audio"] = (t.get("tracker_params") or {}).get("gift_property") == "audio_gift"   # plays a sound
            g["combo"] = bool(t.get("combo"))                                                    # sent in series
            n += 1
        self.refreshed_at = time.time()
        self.save()
        print(f"[gifts] catalog from TikTok: {n} gifts")

    def save(self):
        try:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(dict(self.gifts, _refreshed_at=self.refreshed_at, _backfilled=getattr(self, "backfilled", False)),
                          f, ensure_ascii=False, sort_keys=True)
            os.replace(tmp, self.path)
            self.saved_at, self.dirty = time.time(), False
        except OSError as e:
            print(f"[gifts] catalog not saved: {e}")

    def list(self):
        """[{name, coins, image, seen}]: sent on our streams (most often first), then the rest by price"""
        rows = sorted(self.gifts.items(), key=lambda kv: (-kv[1].get("seen", 0), kv[1]["coins"], kv[0].lower()))
        return [{"name": n, "coins": g["coins"], "image": g.get("image", ""), "seen": g.get("seen", 0),
                 "ru": RU.get(n.strip(), ("", ""))[0], "theme": RU.get(n.strip(), ("", "other"))[1] or "other",
                 "audio": bool(g.get("audio")), "combo": bool(g.get("combo"))} for n, g in rows]


CATALOG = None


def catalog():
    """One catalog for the whole process (all rooms)."""
    global CATALOG
    if CATALOG is None:
        CATALOG = GiftCatalog()
    return CATALOG
