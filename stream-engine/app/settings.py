"""General settings of one game hub (shared by all its games): like balloons, the likes plane, voice,
greetings. Shown in the menu ("⚙ General settings"); defaults come from config, choices are fixed here.
Each hub (one per room on the platform) keeps its own values."""

from . import config


# like thresholds of the shows: one preset list for all of them (0 = off); the streamer may also type any
# whole number in LIKES_RANGE, so these are only the suggestions
LIKE_STEPS = [0, 100, 200, 300, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 250000, 500000, 1000000]
LIKES_RANGE = (10, 10_000_000)


class GlobalSettings:
    name = "global"
    # key -> (config attribute = default, choices); 1/0 = on/off
    OPTIONS = {
        "balloon_likes": ("LIKES_PER_BALLOON", LIKE_STEPS),
        "plane_auto": ("PLANE_AUTO_LIKES", LIKE_STEPS),
        "bomber": ("PLANE_BOMBER_LIKES", LIKE_STEPS),
        "snowball": ("SNOWBALL_LIKES", LIKE_STEPS),
        "cake": ("CAKE_LIKES", LIKE_STEPS),
        "voice_rate": ("VOICE_RATE", [1, 1.25, 1.5, 1.75, 2]),
        "voice_volume": ("VOICE_VOLUME", list(range(0, 101, 10))),
        "fx_volume": ("FX_VOLUME", list(range(0, 101, 10))),
        "greet": ("GREET_JOINS", [1, 0]),
    }
    # the shows that fire by themselves on likes: a room set up before one of them existed gets it off (0), not the
    # config default - a new show must not start on someone's stream until the streamer turns it on
    AUTO = ("balloon_likes", "plane_auto", "bomber", "snowball", "cake")

    def __init__(self):
        self._v = {attr: getattr(config, attr) for attr, _ in self.OPTIONS.values()}

    def load(self, saved):
        """the values saved for the room; a show from AUTO missing there (newer than the room's settings) is off"""
        if not saved:
            return                              # a new room: config defaults
        for k in self.AUTO:
            saved.setdefault(k, 0)
        for k, v in saved.items():
            self.set(k, v)

    def get(self, attr):
        """current value by its config name, e.g. get("LIKES_PER_BALLOON")"""
        return self._v[attr]

    def schema(self):
        return {k: choices for k, (_, choices) in self.OPTIONS.items()}

    def values(self):
        out = {}
        for k, (attr, _) in self.OPTIONS.items():
            v = self._v[attr]
            out[k] = int(v) if isinstance(v, bool) else v
        return out

    def set(self, key, value):
        if key not in self.OPTIONS:
            return False
        attr, choices = self.OPTIONS[key]
        if key in self.AUTO:                    # a like threshold: off or any whole number in LIKES_RANGE
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value != int(value):
                return False
            if value and not LIKES_RANGE[0] <= value <= LIKES_RANGE[1]:
                return False
        elif value not in choices:
            return False
        current = self._v[attr]
        self._v[attr] = bool(value) if isinstance(current, bool) else type(current)(value)
        return True
