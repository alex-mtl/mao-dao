"""Client of the Telegram bot (separate project tiktok-tg-bot: AWS Lambda + DynamoDB).

The viewer's cycle:
  1. "настроить связь" in the stream chat -> the screen shows the bot's @name and the stream word.
  2. In Telegram the viewer sends the stream word and their TikTok nick -> the bot gives a key "ключ-тг-XXXXXXXX".
  3. The viewer types the key in the stream chat -> we send key + the author's TikTok id to the bot.
  4. The bot links the accounts and tells the viewer in Telegram; we show "📲 {name} подключил Telegram".

The stream word comes from the bot (unique among live streams; a game restart mid-stream gets the same
word back). It is requested when the TikTok LIVE connects and released when it has been offline a while.
Settings: TG_BOT_URL and TG_GAME_KEY in .env (infrastructure, not game tunables)."""

import asyncio
import secrets
import re
import time

from . import config

KEY_RE = re.compile(r"ключ-тг-[A-Za-z0-9_-]{8}", re.IGNORECASE)
LINK_COMMANDS = {"настроить связь", "link up"}    # never the messenger's name: TikTok may filter it
OFFLINE_STOP_SEC = 10 * 60         # LIVE offline that long -> the stream word is released
LINK_COOLDOWN_SEC = 60            # "настроить связь": after anyone calls it, nobody can for a minute
SWITCH_COOLDOWN_SEC = 30          # ... a linked viewer: their own toast, at most this often
POLL_SEC = 10                     # asking the bot for words viewers picked (only while LIVE)


def norm(text):
    return " ".join(re.sub(r"[^\w\s]", " ", (text or "").lower().replace("ё", "е")).split())


LINKS_SEC = 300                                  # viewers' Telegram links from the bot, refreshed this often


class TelegramLink:
    def __init__(self, hub, url, key):
        self.hub, self.url, self.key = hub, url.rstrip("/"), key
        self.word = ""
        self.bot = ""
        self.offline_since = None
        self.info_t = 0.0
        self.switch_t = {}            # viewer id -> their last "настроить связь" (a linked viewer moves here)
        self.results = []             # dictionary checks of picked words, not yet delivered to the bot
        # this running copy of the game: the bot warns if two copies use one key (a home game + the platform)
        self.instance = secrets.token_hex(6)
        self.sent_credits = {}        # hint credits as the bot last got them (only changes are sent)
        self.sent_names = {}          # nicknames as the bot last got them (only new/changed ones are sent)
        self.links = {}               # TikTok id -> {tg, id, full}: the viewer's Telegram (the room page links it)
        self.links_t = 0.0            # last time the bot sent them (asked every LINKS_SEC)

    async def api(self, path, **body):
        import httpx
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post(self.url + path, json=body, headers={"authorization": "Bearer " + self.key})
                return r.json() if r.status_code == 200 else {"error": r.status_code}
        except Exception as e:
            print(f"[telegram] {path} error: {type(e).__name__}")
            return {"error": type(e).__name__}

    def on_comment(self, viewer, text):
        """True if the message belongs to the Telegram link and must not go to the game."""
        m = KEY_RE.search(text or "")
        if m:
            asyncio.get_event_loop().create_task(self._key(viewer, m.group(0)))
            return True
        if norm(text) in LINK_COMMANDS:
            now = time.time()
            if now - self.switch_t.get(viewer.id, 0) > SWITCH_COOLDOWN_SEC:
                self.switch_t[viewer.id] = now
                asyncio.get_event_loop().create_task(self._link_up(viewer))
            return True
        return False

    async def _link_up(self, viewer):
        """linked in the bot already: they play in this room now (a toast for them); not linked: the bot's
        name and the stream word for everybody (one call per minute for the whole chat)"""
        r = await self.api("/game/switch", tiktok_id=viewer.id)
        if self.hub.closed:
            return
        if r.get("linked"):
            print(f"[telegram] {viewer.name} plays here now (switched: {r.get('switched')})")
            self.hub.game.emit("tg_switched", name=viewer.name, avatar=viewer.avatar, word=(self.word or "").upper())
            return
        now = time.time()
        if self.word and now - self.info_t > LINK_COOLDOWN_SEC:
            self.info_t = now
            self.hub.game.emit("tg_info", bot=self.bot, word=self.word.upper())

    async def _key(self, viewer, key):
        r = await self.api("/game/key", key=key, tiktok_id=viewer.id, tiktok_name=viewer.name)
        print(f"[telegram] key from {viewer.name}: {r}")
        if r.get("linked") and not self.hub.closed:
            self.hub.game.emit("tg_linked", name=viewer.name, avatar=viewer.avatar)

    async def run(self):
        while True:
            if self.hub.tiktok_status == "connected":
                self.offline_since = None
                if not self.word:
                    r = await self.api("/game/stream/start", tiktok=self.hub.username)
                    self.word, self.bot = r.get("word", ""), r.get("bot", "")
                    if self.word:
                        print(f"[telegram] stream word: {self.word} (bot @{self.bot})")
            elif self.word:
                self.offline_since = self.offline_since or time.time()
                if time.time() - self.offline_since > OFFLINE_STOP_SEC:
                    await self.api("/game/stream/stop")
                    print(f"[telegram] stream word {self.word} released")
                    self.word = ""
            if self.word and not self.hub.closed:
                await self.poll()
            await asyncio.sleep(POLL_SEC)

    async def poll(self):
        """Words viewers offer for the guess game (via the bot): check new ones in the dictionary, queue the
        ones the host accepted and answer with the round; drop rejected ones; report started rounds."""
        g = self.hub.games.get("guess")
        if not g:
            return
        played, g.played_custom = g.played_custom, []
        unguessed, g.unguessed_custom = g.unguessed_custom, []
        credits = {k: v for k, v in g.credits.items() if self.sent_credits.get(k) != v}
        credits.update({k: 0 for k in self.sent_credits if k not in g.credits and self.sent_credits[k]})
        names = dict(list((k, v) for k, v in self.hub.names.items() if self.sent_names.get(k) != v)[:500])
        want_links = time.time() - self.links_t > LINKS_SEC
        r = await self.api("/game/poll", v=2, instance=self.instance, results=self.results, played=played, unguessed=unguessed,
                           credits=credits, names=names, queue_ids=[c["id"] for c in g.custom], want_links=want_links)
        if "error" in r:
            g.played_custom = played + g.played_custom          # retry next time
            g.unguessed_custom = unguessed + g.unguessed_custom
            return
        self.sent_credits.update(credits)
        self.sent_names.update(names)
        if isinstance(r.get("links"), dict):
            self.links, self.links_t = r["links"], time.time()
        self.results = []
        for cid in r.get("cancel") or []:
            g.cancel_custom(cid)
        for w in r.get("words") or []:
            if w.get("action") == "queue":                       # the host accepted it: into the queue
                ok, word, rnd = g.queue_custom(w)
                self.results.append({"id": w["id"], "stage": "queue", "ok": ok, "word": word, "round": rnd})
            else:                                                # new: only the dictionary check
                ok, word = g.check_custom(w)
                self.results.append({"id": w["id"], "stage": "check", "ok": ok, "word": word})
        answers = []                                             # the host asked in the bot: /round, /history N
        for q in r.get("requests") or []:
            if q.get("type") == "round":
                answers.append({"id": q.get("id"), "type": "round", "data": g.round_report()})
            elif q.get("type") == "history":
                answers.append({"id": q.get("id"), "type": "history", "data": g.history_report(q.get("n"))})
        if self.results or answers:                              # answer right away, not in 10 s
            r = await self.api("/game/poll", instance=self.instance, results=self.results, answers=answers,
                               queue_ids=[c["id"] for c in g.custom])
            if "error" not in r:
                self.results = []
                for cid in r.get("cancel") or []:
                    g.cancel_custom(cid)
