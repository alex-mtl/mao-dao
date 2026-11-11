"""Listen mode ("прослушка"): the library only listens to a LIVE the streamer runs from the phone. No game, no
animation on the screen; everything that happens is recorded - chat, likes, gifts, follows, subscriptions and the
battles with their rounds (app/battles.py, app/listen_stats.py are kept by the hub in every mode, this mode just
makes them the panel's main view). The overlay page of this mode is empty and transparent."""

import random

from ..base import BaseGame


class ListenGame(BaseGame):
    name = "listen"
    title = "Listen"
    OPTIONS = {}

    def snapshot(self):
        return {}

    def simulate_step(self):
        return random.uniform(1.5, 3)
