"""Guess the Word as a Telegram Mini App (prototype, 2026-11-03).

One room of the engine (TG_APP_ROOM) is played from phones instead of a TikTok chat: every player opens
the page /tg/ inside Telegram, the page connects to /tg/ws and sends its words there. The room's own game
(GuessGame) does everything else, exactly as with the TikTok chat: a word from a player = a chat line.

Why not through Laravel: a PHP request per word is the most expensive path there is. The page is a static
file; Laravel is not involved at all in the prototype.

Load: what costs is the fan-out (players x messages), not the words. So the players get their own slim
message (the table and the round, no overlay chrome), at most every TG_APP_PUSH_SEC and only when it changed;
a player's own result goes to that player alone.

Protocol (JSON text frames):
  client -> {"auth": "<Telegram.WebApp.initData>"}   first frame; in dev mode (TG_APP_DEV=1) {"dev": "Name"}
  client -> {"word": "море"}                         a guess
  server -> {"type": "hello", "me": {id, name}}      after a good auth (then a "state" at once)
  server -> {"type": "state", ...}                   the round and the table (TgApp.state)
  server -> {"type": "mine", "roundId", "words": [[word, rank]...], "place"}   this player's words
  server -> {"type": "guess", "word", "rank", "place"} / {"type": "reject", "reason", "word"}
"""

import asyncio
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from . import config
from .games.base import Viewer
from .games.guess import game as gmod

AUTH_MAX_AGE = 24 * 3600          # initData older than this is refused (Telegram re-signs it on every open)


def check_init_data(init_data, bot_token, now=None, max_age=AUTH_MAX_AGE):
    """Telegram Mini App initData -> its "user" dict, or None when the signature or the age is wrong.
    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app"""
    if not init_data or not bot_token:
        return None
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError:
        return None
    got = pairs.pop("hash", "")
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()

    def signed_by_bot(fields):
        check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
        return hmac.compare_digest(hmac.new(secret, check.encode(), hashlib.sha256).hexdigest(), got)

    # every field but "hash" is signed, newer clients' "signature" included; a client that leaves it out
    # of the hash is accepted too (either way it is the bot token's HMAC: nobody else can make it)
    if not got or not (signed_by_bot(pairs) or ("signature" in pairs and signed_by_bot(
            {k: v for k, v in pairs.items() if k != "signature"}))):
        return None
    try:
        if (now or time.time()) - int(pairs.get("auth_date", "0")) > max_age:
            return None
        user = json.loads(pairs.get("user") or "null")
    except (ValueError, TypeError):
        return None
    return user if isinstance(user, dict) and user.get("id") else None


def viewer_of(user):
    """Telegram user -> the game's Viewer. Ids are "tg<id>": never the same as a TikTok @id."""
    name = " ".join(x for x in (user.get("first_name"), (user.get("last_name") or "")[:1]) if x).strip()
    name = (name or user.get("username") or "игрок")[:24]
    return Viewer(f"tg{int(user['id'])}", name, user.get("photo_url") or "")


class Player:
    def __init__(self, ws, viewer):
        self.ws = ws
        self.viewer = viewer
        self.last_word_t = 0.0


class TgApp:
    """The Mini App players of one room: who is connected, their words, the slim broadcast."""

    def __init__(self, hub):
        self.hub = hub
        self.players = {}             # websocket -> Player (one person may have two: phone + desktop)
        self.sent = ""                # the last state sent, as JSON (nothing changed -> nothing sent)
        self.empty_since = time.time()  # nobody has the page open since then (None = someone has)

    # ------------------------------------------------------------------ nobody plays -> the game stands still
    # The host's pause of the game (timers frozen, no words, no new rounds, no ranker calls), marked "idle" so that
    # the first player back lifts it and a pause the host set on the room page stays. The mark is saved with the
    # pause, so it survives a restart of the engine.
    def idle_check(self, now=None):
        now = now or time.time()
        g = self.game
        if self.players:
            self.empty_since = None
            return
        if self.empty_since is None:
            self.empty_since = now
        if now - self.empty_since >= config.TG_APP_IDLE_SEC and g.frozen is None and g.host_pause(now):
            g.frozen["idle"] = True
            g.save()
            print(f"[tg-app] nobody for {now - self.empty_since:.0f}s: the game is paused")

    def wake(self, now=None):
        g = self.game
        if g.frozen is not None and g.frozen.get("idle") and g.host_resume(now or time.time()):
            g.save()
            print("[tg-app] a player came: the game goes on")

    @property
    def game(self):
        return self.hub.games["guess"]

    # ------------------------------------------------------------------ what everyone sees
    def state(self):
        g = self.game
        reveal = g.phase in (gmod.WINNER, gmod.REVEAL, gmod.FINISHED)
        rows = sorted(g.guesses.values(), key=lambda r: r["rank"])
        top = [{"w": r["word"].upper(), "r": r["rank"], "n": r["name"], "a": r.get("avatar") or "", "c": r["count"]}
               for r in rows[:config.TG_APP_TOP] if r["rank"] > 1 or reveal]
        return {"type": "state", "phase": g.phase, "roundId": g.round_id, "endsAt": g.ends_at,
                "phaseUntil": g.phase_until, "paused": bool(g.paused_at) or g.frozen is not None,
                "secret": g._shown_word() if reveal else None,
                "winner": g.winner if reveal else None,
                "podium": g.podium if reveal else [],
                "hints": g.hints, "vocab": g.sem.size if g.sem else 0,
                "players": len(g.players), "guesses": sum(p.guesses for p in g.players.values()),
                "online": len(self.players), "top": top}

    def mine(self, vid):
        g = self.game
        p = g.players.get(vid)
        words = sorted(([w.upper(), int(g.rank[g.sem.index[w]])] for w in p.words),
                       key=lambda x: x[1]) if p and g.rank is not None and g.sem else []
        return {"type": "mine", "roundId": g.round_id, "words": words[:50], "place": self.place(vid)}

    def place(self, vid):
        for i, p in enumerate(self.game._ranked(), 1):
            if p.id == vid:
                return i
        return 0

    # ------------------------------------------------------------------ one player
    async def session(self, ws):
        """one websocket of the page, from the auth to the disconnect"""
        try:
            first = json.loads(await asyncio.wait_for(ws.receive_text(), 15))
        except Exception:
            await ws.close(code=4400)
            return
        user = None
        if isinstance(first, dict):
            user = check_init_data(first.get("auth"), config.TG_APP_BOT_TOKEN)
            if not user and config.TG_APP_DEV and first.get("dev"):      # local testing outside Telegram
                name = str(first["dev"])[:20]
                user = {"id": int(hashlib.sha1(name.encode()).hexdigest()[:8], 16), "first_name": name}
        if not user:
            keys = sorted(dict(parse_qsl(first.get("auth") or "")).keys()) if isinstance(first, dict) else []
            print(f"[tg-app] auth refused (initData fields: {keys or 'none'})")
            await ws.send_text(json.dumps({"type": "reject", "reason": "auth"}))
            await ws.close(code=4401)
            return
        p = Player(ws, viewer_of(user))
        self.players[ws] = p
        self.empty_since = None
        self.wake()
        print(f"[tg-app] {p.viewer.name} ({p.viewer.id}) in, {len(self.players)} online")
        try:
            await self.send(ws, {"type": "hello", "me": {"id": p.viewer.id, "name": p.viewer.name}})
            await self.send(ws, dict(self.state(), now=time.time()))
            await self.send(ws, self.mine(p.viewer.id))
            while True:
                try:
                    msg = json.loads(await ws.receive_text())
                except ValueError:
                    continue
                if isinstance(msg, dict) and msg.get("word"):
                    await self.send(ws, self.guess(p, str(msg["word"])))
        except Exception:
            pass                                          # disconnected
        finally:
            self.players.pop(ws, None)

    def guess(self, p, text, now=None):
        """a player's word -> the answer for that player alone; the game gets it as a chat line"""
        now = now or time.time()
        g = self.game
        word = text.strip()[:30]
        if now - p.last_word_t < config.TG_APP_WORD_SEC:  # scripts must not run the dictionary through
            return {"type": "reject", "reason": "slow", "word": word,
                    "wait": round(config.TG_APP_WORD_SEC - (now - p.last_word_t), 1)}
        if len(word.split()) != 1:
            return {"type": "reject", "reason": "one", "word": word}
        if g.phase != gmod.PLAYING or g.rank is None or not g.sem or g.paused_at or g.frozen is not None:
            return {"type": "reject", "reason": "wait", "word": word}
        norm, raw = g.sem.normalize(word)
        if raw is None:
            return {"type": "reject", "reason": "bad", "word": word}
        if norm is None:
            return {"type": "reject", "reason": "unknown", "word": word}
        p.last_word_t = now
        known = g.players.get(p.viewer.id)
        again = bool(known and norm in known.words)
        self.hub.comment(p.viewer, norm)                  # exactly as a TikTok chat line
        rank = int(g.rank[g.sem.index[norm]]) if g.rank is not None else 0
        # all their words: the game may add more than the one typed (a champion's rank neighbours)
        return dict(self.mine(p.viewer.id), type="guess", word=norm.upper(), rank=rank, again=again)

    # ------------------------------------------------------------------ everyone
    async def send(self, ws, msg):
        await ws.send_text(msg if isinstance(msg, str) else json.dumps(msg, ensure_ascii=False))

    async def broadcaster(self):
        """the state to every player, at most every TG_APP_PUSH_SEC, only when it changed"""
        while True:
            await asyncio.sleep(config.TG_APP_PUSH_SEC)
            try:
                self.idle_check()
            except Exception as e:
                print("[tg-app] idle check error:", type(e).__name__, e)
            if not self.players:
                continue
            try:
                s = self.state()
                key = json.dumps(s, ensure_ascii=False)
                if key == self.sent:
                    continue
                self.sent = key
                s["now"] = time.time()                    # the page's clock offset for the timer
                msg = json.dumps(s, ensure_ascii=False)
                await asyncio.gather(*(self._push(ws, msg) for ws in list(self.players)))
            except Exception as e:
                print("[tg-app] broadcast error:", type(e).__name__, e)

    async def _push(self, ws, msg):
        try:
            await asyncio.wait_for(ws.send_text(msg), 3)
        except Exception:
            self.players.pop(ws, None)                    # gone or too slow: the page reconnects
