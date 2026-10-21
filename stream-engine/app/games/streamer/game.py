"""Streamer overlay: a transparent page on top of the streamer's video with reactions.

Like balloons are shared by all pages and live in the hub (app/reactions/balloons.py);
this "game" gives the overlay its own place in the menu and its frame format: the page draws an
invisible 9:16 / 9:19.5 / 9:20 frame (the phone picture in TikTok LIVE Studio) and the balloons are
born at its bottom edge and fly up through it, like the planes and butterflies.
"""

import random

from ..base import BaseGame


class StreamerOverlay(BaseGame):
    name = "streamer"
    title = "Streamer"
    OPTIONS = {"frame": [16, 19.5, 20]}            # frame 9:16 / 9:19.5 (phones) / 9:20

    def __init__(self, store):
        super().__init__(store)
        self.frame = 16

    def set_option(self, key, value):
        if key == "frame" and float(value) in self.OPTIONS["frame"]:
            self.frame = float(value) if float(value) % 1 else int(value)

    def get_options(self):
        return {"frame": self.frame}

    def snapshot(self):
        return {"frame": self.frame}

    def simulate_step(self):
        return random.uniform(0.3, 0.8)      # the hub simulator sends the fake likes
