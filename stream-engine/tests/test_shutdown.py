"""The engine process on SIGTERM (systemctl restart) must reach its final save, and a round start is
saved at once - a restart right after a round started used to bring back the previous round."""

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest


class ShutdownSavesTest(unittest.TestCase):
    def test_sigterm_reaches_the_final_save(self):
        data = tempfile.mkdtemp()
        env = dict(os.environ, DATA_DIR=data, DEV_ROOMS="1", PORT="8791", HOST="127.0.0.1", PYTHONUNBUFFERED="1")
        proc = subprocess.Popen([sys.executable, "-m", "app"], env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        out = []
        deadline = time.time() + 60
        while time.time() < deadline:                       # wait until it listens
            line = proc.stdout.readline()
            out.append(line)
            if "listening on" in line:
                break
        self.assertTrue(any("listening on" in l for l in out), "".join(out))
        time.sleep(1)
        proc.send_signal(signal.SIGTERM)
        rest, _ = proc.communicate(timeout=30)
        out.append(rest)
        text = "".join(out)
        self.assertIn("[room] stopped, state saved", text)   # the final save ran
        self.assertIn("stopped, state saved.", text)
        self.assertEqual(proc.returncode, 0)
        with open(os.path.join(data, "rooms.json"), encoding="utf-8") as f:
            rooms = json.load(f)
        self.assertTrue(rooms["dev1"]["running"])            # the room starts again after the restart


class SaveNowTest(unittest.TestCase):
    def test_round_start_is_saved_at_once(self):
        from app.games.guess.game import GuessGame
        from app.hub import Hub
        from app.storage import JsonStore
        hub = Hub(JsonStore(tempfile.mkdtemp()), username="")
        hub.set_active("guess")
        g = hub.game
        self.assertIsInstance(g, GuessGame)
        saved = []
        g.save = lambda: saved.append(g.phase)
        g.tick(time.time()); hub._save_if_needed()
        g.tick(time.time() + 0.01); hub._save_if_needed()
        self.assertTrue(saved)                               # countdown / round start went to disk at once
        self.assertFalse(g.save_now)


if __name__ == "__main__":
    unittest.main()
