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


class Toasts:
    """Only what differs from the defaults is kept: {id: {"show": 0/1, "voice": 0/1, "rate": x}}."""

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
            if "rate" in v:
                if v["rate"] in RATES:
                    cur["rate"] = v["rate"]
                elif v["rate"] is None:
                    cur.pop("rate", None)
            self._v[tid] = cur

    def values(self):
        return {tid: dict(v) for tid, v in self._v.items() if v}

    def schema(self):
        return {"ids": TOASTS, "rates": RATES}


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


class GiftCatalog:
    """Gifts seen on the platform's streams, shared by all rooms: {name: coins}. Starts from the gifts
    known before (0 = price not seen yet: TikTok sends it with the first such gift); a gift is saved again
    only when it's new or its price changed."""
    KNOWN = {"Rose": 1, "TikTok": 1, "GG": 1, "Heart Me": 1, "Ice Cream Cone": 1, "Finger Heart": 5,
             "Doughnut": 30, "Cake Slice": 0, "Chilli pepper": 0, "Mirwas Beat": 0, "Popular Vote": 0,
             "Perfume": 0, "Eye for an Eye": 0, "Encore Ticket": 0, "Journey Pass": 0, "Freestyle": 0,
             "Hand Hearts": 0, "Confetti": 0, "Corgi": 0, "Galaxy": 0, "Lion": 0, "Universe": 0}

    def __init__(self, path=None):
        self.path = path or os.path.join(config.DATA_DIR, "gifts_seen.json")
        self.gifts = dict(self.KNOWN)
        try:
            with open(self.path, encoding="utf-8") as f:
                self.gifts.update(json.load(f))
        except (OSError, ValueError):
            pass
        self.saved_at = 0.0

    def record(self, name, coins):
        if not name:
            return
        coins = int(coins or 0)
        if name in self.gifts and (not coins or self.gifts[name] == coins):
            return
        self.gifts[name] = coins or self.gifts.get(name, 0)
        try:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.gifts, f, ensure_ascii=False, sort_keys=True)
            os.replace(tmp, self.path)
            self.saved_at = time.time()
        except OSError as e:
            print(f"[gifts] catalog not saved: {e}")

    def list(self):
        """[{name, coins}] cheapest first."""
        return [{"name": n, "coins": c} for n, c in sorted(self.gifts.items(), key=lambda kv: (kv[1], kv[0].lower()))]


CATALOG = None


def catalog():
    """One catalog for the whole process (all rooms)."""
    global CATALOG
    if CATALOG is None:
        CATALOG = GiftCatalog()
    return CATALOG
