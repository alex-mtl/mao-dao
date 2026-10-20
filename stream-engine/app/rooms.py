"""Rooms: on the platform every streamer's game is a Room - its own Hub (games, settings, state), data
folder, TikTok connection, Telegram link and ranker client. Many rooms live in one process and share
the dictionaries. A room runs only between "start" and "stop" (the platform's buttons); a stopped
room keeps its data and its pages answer with the last state.

The registry (data/rooms.json) keeps each room's configuration, so after a restart of the process
the rooms that were running start again by themselves."""

import asyncio
import json
import os
import secrets
import time

from . import config
from .context import current_room
from .hub import Hub
from .storage import JsonStore

# what the platform may set for a room
FIELDS = ("username", "lang", "euler_key", "overlay_token", "control_token", "simulate", "tg_key")


def new_token():
    return secrets.token_urlsafe(24)


class Room:
    def __init__(self, rid, cfg, data_root):
        self.id = rid
        self.cfg = cfg
        self.dir = os.path.join(data_root, "rooms", rid)
        self.hub = None
        self.tasks = []
        self.connector = None
        self.started_at = 0.0

    @property
    def running(self):
        return bool(self.tasks)

    def ensure_hub(self):
        """the room's games and state (loaded on first use, kept while the process lives)"""
        if self.hub is None:
            token = current_room.set(self.id)
            try:
                self.hub = Hub(JsonStore(self.dir), username=self.cfg.get("username") or "")
                if self.cfg.get("lang"):
                    self.hub.set_lang(self.cfg["lang"])
            finally:
                current_room.reset(token)
        return self.hub

    def start(self):
        if self.running:
            return
        token = current_room.set(self.id)                 # the tasks below inherit the room for the log
        try:
            hub = self.ensure_hub()
            hub.closed = False
            jobs = [hub.ticker(), hub.saver(), hub.broadcaster()]
            if self.cfg.get("simulate") or not self.cfg.get("username"):
                jobs.append(hub.simulator())
            else:
                from .tiktok.client import TikTokConnector
                self.connector = TikTokConnector(hub, self.cfg["username"], self.cfg.get("euler_key") or None)
                jobs.append(self.connector.run_forever())
            key = self.cfg.get("tg_key") or ""
            if config.TG_BOT_URL and key:
                from .telegram_link import TelegramLink
                hub.tg = TelegramLink(hub, config.TG_BOT_URL, key)
                jobs.append(hub.tg.run())
            if config.RANKER_URLS and key:
                from .ranker_client import RankerClient
                jobs.append(RankerClient(hub, config.RANKER_URLS, key).run())
            self.tasks = [asyncio.get_running_loop().create_task(j) for j in jobs]
            self.started_at = time.time()
            print(f"[room] started (@{self.cfg.get('username') or 'simulation'})")
        finally:
            current_room.reset(token)

    async def stop(self):
        if not self.running:
            return
        token = current_room.set(self.id)
        try:
            hub = self.hub
            hub.closed = True                             # no events after this point (a late chat line)
            for t in self.tasks:
                t.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            self.tasks, self.connector = [], None
            for g in hub.games.values():                  # final save
                g.save()
            hub.save_session()
            hub.balloons.save()
            hub.tiktok_status = "offline"
            hub.tg = None
            print("[room] stopped, state saved")
        finally:
            current_room.reset(token)

    def status(self):
        hub = self.hub
        return {"id": self.id, "running": self.running, "username": self.cfg.get("username") or "",
                "simulate": bool(self.cfg.get("simulate")), "started_at": self.started_at if self.running else None,
                "tiktok": hub.tiktok_status if hub else "offline", "active": hub.active if hub else None,
                "lang": hub.lang if hub else self.cfg.get("lang"), "euler_key": bool(self.cfg.get("euler_key")),
                "clients": len(hub.clients) if hub else 0}


class RoomManager:
    FILE = "rooms.json"

    def __init__(self, data_root):
        self.root = data_root
        os.makedirs(data_root, exist_ok=True)
        self.path = os.path.join(data_root, self.FILE)
        self.rooms = {}
        for rid, cfg in self._load().items():
            self.rooms[rid] = Room(rid, cfg, data_root)

    def _load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return {}

    def save(self, running=None):
        running = running if running is not None else {rid for rid, r in self.rooms.items() if r.running}
        data = {rid: dict(r.cfg, running=rid in running) for rid, r in self.rooms.items()}
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)
        try:
            os.chmod(self.path, 0o600)                    # holds Euler keys
        except OSError:
            pass

    def upsert(self, rid, fields):
        """create or update a room; tokens are made if the platform doesn't give them. A changed username,
        Euler key or bot key applies at the next start."""
        room = self.rooms.get(rid)
        if room is None:
            room = self.rooms[rid] = Room(rid, {}, self.root)
        for k in FIELDS:
            if k in fields:
                room.cfg[k] = fields[k]
        room.cfg.setdefault("overlay_token", new_token())
        room.cfg.setdefault("control_token", new_token())
        if "lang" in fields and room.hub:
            room.hub.set_lang(fields["lang"])
        if "username" in fields and room.hub:
            room.hub.username = (fields["username"] or "").lstrip("@").lower()
        self.save()
        return room

    async def delete(self, rid):
        room = self.rooms.pop(rid, None)
        if room:
            await room.stop()
            self.save()                                   # its data folder stays

    def by_token(self, token):
        """-> (room, "control" | "overlay") or (None, None)"""
        for room in self.rooms.values():
            if token and secrets.compare_digest(token, room.cfg.get("control_token", "")):
                return room, "control"
            if token and secrets.compare_digest(token, room.cfg.get("overlay_token", "")):
                return room, "overlay"
        return None, None

    async def start(self, rid):
        self.rooms[rid].start()
        self.save()

    async def stop(self, rid):
        await self.rooms[rid].stop()
        self.save()

    def restore(self):
        """after a restart: the rooms that were running start again"""
        for rid, cfg in self._load().items():
            if cfg.get("running") and rid in self.rooms:
                self.rooms[rid].start()

    async def stop_all(self):
        """process shutdown: stop everything but remember what ran, to start it again after the restart"""
        running = {rid for rid, r in self.rooms.items() if r.running}
        for room in self.rooms.values():
            await room.stop()
        self.save(running)
