"""What happened on each LIVE, for cutting clips and digests later (docs/games/guessword.md, "Live logs").

One JSONL file per LIVE in the room's folder: DATA_DIR/rooms/<room>/lives/<YYYY-MM-DD_HHMMSS>_<tiktok room>.jsonl,
one line per event: {"t": ISO time, "s": seconds since the LIVE started, "type": ..., fields}. A viewer is
{"uid": numeric TikTok id (stable, "" if unknown), "id": @unique_id, "name": nickname at that moment}.

Avatars: TikTok's avatar links are signed and stop working after a few days, so the picture itself is kept in
DATA_DIR/avatars/<uid or @unique_id>.<jpg|webp|png>, downloaded in the background (never blocks the game)."""

import json
import os
import queue
import re
import threading
import time
import urllib.request
from datetime import datetime, timezone

from . import config

AVATAR_REFRESH_SEC = 7 * 86400            # an avatar older than this is fetched again (people change them)
AVATAR_TIMEOUT_SEC = 10
AVATAR_MAX_BYTES = 512 * 1024
AVATAR_QUEUE_MAX = 2000                   # a huge LIVE: the rest waits for the viewer's next LIVE
AVATAR_TYPES = {"image/jpeg": "jpg", "image/webp": "webp", "image/png": "png", "image/gif": "gif"}


def safe_key(key):
    """a file name for a viewer: the numeric id, or the @unique_id cut to safe characters"""
    return re.sub(r"[^a-z0-9._-]", "_", str(key or "").lower())[:64].strip(".")


class AvatarCache:
    """Downloads avatars in one background thread; failures only go to the log."""

    def __init__(self, folder):
        self.folder = folder
        os.makedirs(folder, exist_ok=True)
        self.jobs = queue.Queue(AVATAR_QUEUE_MAX)
        self.pending = set()
        self.lock = threading.Lock()
        self.thread = None

    def find(self, key):
        """path of the saved picture or None"""
        key = safe_key(key)
        if not key:
            return None
        for ext in AVATAR_TYPES.values():
            p = os.path.join(self.folder, f"{key}.{ext}")
            if os.path.isfile(p):
                return p
        return None

    def want(self, key, url):
        """fetch the picture unless a fresh one is saved; returns at once"""
        key = safe_key(key)
        if not key or not url.startswith("https://"):
            return
        p = self.find(key)
        if p and time.time() - os.path.getmtime(p) < AVATAR_REFRESH_SEC:
            return
        with self.lock:
            if key in self.pending:
                return
            try:
                self.jobs.put_nowait((key, url))
            except queue.Full:
                return
            self.pending.add(key)
            if self.thread is None:
                self.thread = threading.Thread(target=self._work, name="avatars", daemon=True)
                self.thread.start()

    def _work(self):
        while True:
            key, url = self.jobs.get()
            try:
                self.fetch(key, url)
            except Exception as e:
                print(f"[avatars] {key}: {type(e).__name__}: {str(e)[:120]}")
            finally:
                with self.lock:
                    self.pending.discard(key)

    def fetch(self, key, url):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=AVATAR_TIMEOUT_SEC) as r:
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            data = r.read(AVATAR_MAX_BYTES + 1)
        ext = AVATAR_TYPES.get(ctype) or ("webp" if data[8:12] == b"WEBP" else
                                          "png" if data[:4] == b"\x89PNG" else
                                          "jpg" if data[:2] == b"\xff\xd8" else None)
        if not ext or not data or len(data) > AVATAR_MAX_BYTES:
            raise ValueError(f"not an avatar ({ctype or '?'}, {len(data)} bytes)")
        old = self.find(key)
        tmp = os.path.join(self.folder, f".{key}.{ext}.tmp")
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, os.path.join(self.folder, f"{key}.{ext}"))
        if old and not old.endswith("." + ext):            # the picture changed format: one file per viewer
            os.remove(old)


_avatars = None


def configure(data_root):
    """the engine's data folder (RoomManager): avatars of every room go to DATA_DIR/avatars"""
    global _avatars
    _avatars = AvatarCache(os.path.join(data_root, "avatars"))


def avatars():
    return _avatars


class LiveLog:
    """The room's log of the current LIVE. The hub calls open() on every TikTok connect; a reconnect or a
    restart of the engine during the same LIVE goes on writing the same file."""

    def __init__(self, folder):
        self.folder = folder
        self.path = None
        self.started = 0.0
        self.tiktok_room = None
        self.seen = {}                           # @unique_id (lower) -> (uid, name) seen this LIVE
        self.uids = {}                           # @unique_id (lower) -> numeric id, from any event

    def open(self, tiktok_room, username=""):
        tiktok_room = str(tiktok_room or "")
        if self.path and tiktok_room == self.tiktok_room:
            return
        self.path, self.seen = None, {}
        self.tiktok_room = tiktok_room
        tag = safe_key(tiktok_room) or "unknown"
        try:
            os.makedirs(self.folder, exist_ok=True)
            same = sorted(f for f in os.listdir(self.folder) if tiktok_room and f.endswith(f"_{tag}.jsonl"))
            if same:                             # the same LIVE as before the restart: go on with its file
                self.path = os.path.join(self.folder, same[-1])
                with open(self.path, encoding="utf-8") as f:
                    self.started = json.loads(f.readline()).get("epoch") or os.path.getmtime(self.path)
                return
            self.started = round(time.time(), 3)
            name = time.strftime("%Y-%m-%d_%H%M%S", time.localtime(self.started)) + f"_{tag}.jsonl"
            self.path = os.path.join(self.folder, name)
            self.write("live_start", epoch=self.started, tiktok_room=tiktok_room or None,
                       username=username or None)
            print(f"[live] log {name}")
        except Exception as e:
            print(f"[live] can't open the log: {type(e).__name__}: {e}")
            self.path = None

    def user(self, viewer_id, name=""):
        vid = str(viewer_id or "")
        return {"uid": self.uids.get(vid.lower(), ""), "id": vid, "name": name or vid}

    def write(self, kind, **fields):
        if not self.path:
            return
        now = time.time()
        line = {"t": datetime.fromtimestamp(now, timezone.utc).astimezone().isoformat(timespec="milliseconds"),
                "s": round(now - self.started, 1), "type": kind}
        line.update({k: v for k, v in fields.items() if v is not None})
        try:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
        except Exception as e:
            print(f"[live] write error: {type(e).__name__}: {e}")

    def viewer(self, v):
        """every event's viewer: a "viewer" line when they first show up in this LIVE or change their
        nickname, and their avatar saved"""
        vid = (v.id or "").lower()
        if not vid:
            return
        uid = str(getattr(v, "uid", "") or "")
        if uid:
            self.uids[vid] = uid
            if len(self.uids) > 50000:
                self.uids.clear()
        uid = self.uids.get(vid, "")
        if self.seen.get(vid) == (uid, v.name):
            return
        first = vid not in self.seen
        self.seen[vid] = (uid, v.name)
        if not self.path:
            return
        self.write("viewer", user=self.user(v.id, v.name), first=first or None)
        if first and v.avatar and _avatars:
            _avatars.want(uid or vid, v.avatar)

    def gift(self, v, gift, count, coins, actions, to):
        """big gifts (from LIVE_LOG_GIFT_COINS coins per batch) and every gift bound to an action other than a hint"""
        if (coins or 0) * count >= config.LIVE_LOG_GIFT_COINS or set(actions) - {"hint"}:   # any gift = a hint
            self.write("gift", user=self.user(v.id, v.name), gift=gift, count=count, coins=coins or None,
                       actions=sorted(actions) or None, to=to or None)
