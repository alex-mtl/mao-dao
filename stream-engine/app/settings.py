"""General settings of one game hub (shared by all its games): like balloons, the likes plane, voice,
greetings. Shown in the menu ("⚙ General settings"); defaults come from config, choices are fixed here.
Each hub (one per room on the platform) keeps its own values."""

from . import config


class GlobalSettings:
    name = "global"
    # key -> (config attribute = default, choices); 1/0 = on/off
    OPTIONS = {
        "balloon_likes": ("LIKES_PER_BALLOON", [0, 50, 100, 200, 500, 1000, 2000, 5000, 10000]),   # 0 = off
        "plane_auto": ("PLANE_AUTO_LIKES", [0, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]),
        "bomber": ("PLANE_BOMBER_LIKES", [0, 1000, 5000, 10000, 20000, 50000, 100000, 500000]),
        "voice_rate": ("VOICE_RATE", [1, 1.25, 1.5, 1.75, 2]),
        "voice_volume": ("VOICE_VOLUME", list(range(0, 101, 10))),
        "fx_volume": ("FX_VOLUME", list(range(0, 101, 10))),
        "greet": ("GREET_JOINS", [1, 0]),
    }

    def __init__(self):
        self._v = {attr: getattr(config, attr) for attr, _ in self.OPTIONS.values()}

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
        if value not in choices:
            return False
        current = self._v[attr]
        self._v[attr] = bool(value) if isinstance(current, bool) else type(current)(value)
        return True
