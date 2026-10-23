"""Guess the Word: viewers type English words, each gets a semantic rank vs the
secret word. First exact guess wins; on timeout the best rank wins.

Round state machine (explicit, no boolean soup):
    IDLE -> COUNTDOWN -> PLAYING -> WINNER -> REVEAL -> FINISHED -> COUNTDOWN ...
Everything runs on one asyncio loop, so a guess and the timeout can never both
pick a winner: the first one moves PLAYING -> WINNER and the other sees WINNER.
"""

import json
import math
import os
import random
import re
import time
from collections import deque

import numpy as np

from ... import config
from ..base import BaseGame, Viewer
from . import hints
from .players import RoundPlayer, SessionStats

IDLE, COUNTDOWN, PLAYING, WINNER, REVEAL, FINISHED = (
    "idle", "countdown", "playing", "winner", "reveal", "finished")

TEMPS = ["PERFECT", "BURNING", "VERY HOT", "HOT", "WARM", "COLD", "FREEZING"]
# (max rank, level) milestones for "close guess" events, best first
CLOSE_LEVELS = [(2, "so_close"), (3, "top3"), (10, "top10"), (50, "top50"), (100, "top100")]
EXACT_WINDOW_SEC = 3          # exact guesses right after the winner still make the podium
# typed alone in chat by a viewer with hint credits: spends one credit on a close-word hint
HINT_WORDS = {"подсказка", "hint"}
# "my hints" in chat: the ticker tells the viewer how many hints they have on account
MY_HINTS_WORDS = {"мои подсказки", "мои подскази", "какие подсказки", "сколько подсказок",
                  "my hints", "mes indices", "mis pistas"}
# "мао внимание": a leader of the day / round calls the host (red ticker + voice), once per MAO_CALL_SEC
MAO_CALL_WORDS = {"мао внимание", "mao внимание", "mao attention"}
MAO_CALL_SEC = 30
SETTER_TICKER_SEC = 120                          # "this word was picked by ..." on the ticker every 2 minutes
LOG_EVENTS = {"round_start", "gift", "hint", "boost", "steal", "new_leader", "winner", "timeout", "mao_call"}
LOG_KEYS = ("name", "gift", "count", "word", "by", "rank", "kind", "reason", "cmd", "n")
STUCK_PAUSE_SEC = 120                          # the active game paused this long = a bug: drop the round, start anew
LAST_NAMER_SEC = 20           # a row shows who named its word last this long, then the first namer again
FANS_NOTE_SEC = 30            # "only the team plays" reminder for one viewer at most this often
MAX_WORDS = 5000              # cap of aggregated words per round (memory guard)
SIM_NAMES = ["Alex", "Mike", "Sarah", "John", "Emma", "Liam", "Olivia", "Noah", "Mia", "Leo"]


_INDEXES = {}                                    # assets dir -> indexes: one copy per process, shared by rooms


def load_indexes(assets_dir):
    """{key: SemanticIndex} for every folder in assets: "en", "ru" (normal level),
    "en-easy", "ru-easy" (easy level, the original dictionary) and "ru-hard". Loaded once per process."""
    if assets_dir not in _INDEXES:
        _INDEXES[assets_dir] = _load_indexes(assets_dir)
    return _INDEXES[assets_dir]


def _load_indexes(assets_dir):
    from .semantic import SemanticIndex
    out = {}
    try:
        if os.path.exists(os.path.join(assets_dir, "vocab.txt")):     # old single-language layout
            out["en"] = SemanticIndex(assets_dir, "en")
        for lang in sorted(os.listdir(assets_dir)):
            path = os.path.join(assets_dir, lang)
            if os.path.isfile(os.path.join(path, "vocab.txt")):
                out[lang] = SemanticIndex(path, lang.split("-")[0])
    except Exception as e:
        print(f"[guess] can't load word assets: {type(e).__name__}: {e}")
    return out


def now_past(t):
    return time.time() >= t


def temperature(rank):
    for bound, label in zip(config.TEMPERATURE_BOUNDS, TEMPS):
        if rank <= bound:
            return label
    return TEMPS[-1]


def account_id(viewer_id):
    """Hint accounts are keyed by the TikTok id in lower case (TikTok may send "Horadrim1108")."""
    return (viewer_id or "").strip().lstrip("@").lower()


def temp_key(label):
    return label.lower().replace(" ", "")


class GuessGame(BaseGame):
    name = "guess"
    title = "Guess the Word"
    OPTIONS = {"pause": [0, 10, 30, 60, 120],      # break between rounds, seconds (incl. the winner card)
               "round_min": [10, 20, 30],          # round length, minutes
               "follow": [2, 1, 0],                # who plays: the host's team (fans) only / followers only / all
               "fan_min": [1, 5, 10, 15, 20, 25, 30, 40],   # fans only: from this team level
               "grace": [15, 30, 60],              # seconds a non-follower gets to follow
               "level": [1, 2, 3],                 # dictionary: 1 easy (any word), 2 normal (nouns), 3 hard (ru only)
               "hint_cd": [5, 10, 15, 20],         # seconds between two hints of the same viewer
               "chroma": [0, 1],                   # TikTok chroma key: green top for the streamer's camera
               "chroma_top": [25, 30, 32, 33, 35, 40, 45, 50],   # height of that green zone, % of the frame
               "frame": [16, 19.5, 20],            # frame 9:16 / 9:19.5 (phones) / 9:20
               "chat_zone": [0, 10, 15, 20, 25, 30, 35],  # % of the frame kept free at the bottom: the stream chat stays readable
               "row_anim": [0, 0.1, 0.2, 0.5]}           # a new table row slides in this fast when the chat is busy (s)
    STATE = "guess/state.json"
    USED = "guess/used_words.json"
    ROUNDS = "guess/rounds.json"
    BOOSTS = "guess/boosts.json"                  # viewers with "3 words" for the whole stream (a gift)
    CREDITS = "guess/hint_credits.json"          # viewer id -> hint credits ("on account")
    CREDITS_EVER = "guess/hint_credits_ever.json"  # everyone who ever had hints on account
    CUSTOM = "guess/custom_words.json"           # words viewers picked via the bot ("загадывает"), in order
    MISSING = "guess/missing_words.jsonl"        # their words that aren't in the dictionary (to extend it)

    def __init__(self, store):
        super().__init__(store)
        self.sems, self.error = load_indexes(config.ASSETS_DIR), None
        if not self.sems:
            self.error = f"semantic engine unavailable: no word assets in {config.ASSETS_DIR}"
            print("[guess]", self.error)
        self.lang = config.LANGUAGE if config.LANGUAGE in self.sems else next(iter(self.sems), "en")
        self.round_lang = self.lang                  # language of the round being played
        # break between rounds (winner card + results + promo) and round length; set in the menu
        self.pause_sec = (config.WINNER_SEC + config.REVEAL_SEC) if config.ROUND_BREAK else 0
        self.round_sec = config.ROUND_DURATION
        self.follow_required = config.FOLLOW_REQUIRED    # only followers can play (menu setting)
        self.fans_only, self.fan_min = False, 1          # only the host's team, from this level (menu setting)
        self.fans_note_t = {}                            # viewer id -> last "only the team plays" reminder
        self.follow_grace = int(config.FOLLOW_GRACE_SEC)
        self.level = self.round_level = 2            # dictionary level, from the next round
        self.hint_cd = 20                            # a viewer's next hint (gift or credit) after this many s
        self.chroma, self.chroma_top = False, 33     # green zone on top (keyed out in TikTok LIVE Studio)
        self.chat_zone = 20                           # % of the frame at the bottom left to the stream chat
        self.row_anim = 0.2                           # a new row slides in this fast at the busiest (calm: smoother)
        self.frame = 16                              # frame format 9:frame
        self.hint_t = {}                             # viewer id -> time of their last hint
        self.mao_call_t = 0.0                        # last "мао внимание"
        self.custom = store.load(self.CUSTOM, []) or []   # [{id, word, lang, name, tiktok_id}]
        self.played_custom = []                      # ids of custom words whose round started (for the bot)
        self.unguessed_custom = []                   # viewers' words nobody found (for the bot: saved for them)
        self.next_pick = None                        # (lang, level, word, tier) picked ahead for the next round
        self.ranks = {}                              # (dict, word) -> rank array from the ranker Lambda
        self.rank_source = ""                        # "lambda" | "local": where this round's table came from
        self.restore_wait = False                    # restored round waits for its table (timers stopped)
        self.resume_on_table = False                 # ... and resumes when it comes, if the game is active
        self.stuck_since = 0.0                       # active but paused since (see tick: STUCK_PAUSE_SEC)
        self.waiting_since = 0.0                     # next round waits for its table since
        self.stats = SessionStats(store)
        used = store.load(self.USED, {})
        if isinstance(used, list):                   # old format: English only
            used = {"en": used}
        # words the game itself picked (and viewers' / the host's words): never picked again, on any stream,
        # until every word of the dictionary's pools has been played - then a new cycle starts
        self.used = {k: set(v) for k, v in used.items()}
        self.history = store.load(self.ROUNDS, [])
        for r in self.history:                       # rounds played before the list was kept across streams
            for lang, sem in self.sems.items():
                if r.get("word") in sem.index:
                    self.used.setdefault(lang.split("-")[0], set()).add(r["word"])
                    break
        self.boost_ids = set(store.load(self.BOOSTS, []) or [])
        self.credits = {}
        for k, v in (store.load(self.CREDITS, {}) or {}).items():
            if int(v) > 0:
                self.credits[account_id(k)] = self.credits.get(account_id(k), 0) + int(v)
        ever = store.load(self.CREDITS_EVER, None)
        # first start: everyone with hints now, plus those known to have had (and spent) them
        self.credits_ever = {account_id(k) for k in ever} if ever is not None \
            else set(self.credits) | {"soniapyu", "jelenalena71"}
        self.round_id = 0
        self.difficulty = []          # (solved, seconds, best rank) of recent rounds
        self.tier = "easy"
        self.paused_at = None
        self.frozen = None                           # the host paused the game: {at, elapsed, ends, phase} (s)
        self.pause_after = 0                         # the host asked for a break after this round (0 = no)
        self._clear_round()
        self.phase = IDLE
        self.load()

    # ------------------------------------------------------------------ round
    def _clear_round(self):
        self.secret = None
        self.rank = self.order = None
        self.round_type = "normal"
        self.started_at = self.ends_at = self.phase_until = 0.0
        self.guesses = {}             # word -> aggregated guess
        self.recent = deque(maxlen=10)
        self.flips = deque()          # times a row goes back from its last namer to its first one (a re-render)
        self.players = {}             # id -> RoundPlayer
        self.leader_id = None
        self.past_leaders = set()
        self.winner = None
        self.podium = []
        self.exact_order = []
        self.hints = []
        self.last_hint_t = 0.0
        self.auto_hint_done = False
        self.finished_at = 0.0
        self.unknown_t = 0.0
        self._batch = None                               # collects the words of a several-words comment
        self.multi_ids = set()                           # viewers whose gift lets them send 3 words this round
        self.stolen_by = None                            # the viewer winning with a "steal the win" gift, now
        self.setter = None            # {"id", "name"} of the viewer who picked this round's word
        self.word_hidden = False      # a viewer's word nobody found: never shown
        self.setter_t = 0.0
        self.log = []                 # the round's events for the room page's monitor
        self.guess_times = deque(maxlen=3000)   # accepted guesses: the chat's pace

    def emit(self, type, **data):
        super().emit(type, **data)
        if type in LOG_EVENTS and hasattr(self, "log"):
            self.log = (self.log + [dict({k: data[k] for k in LOG_KEYS if data.get(k) is not None},
                                         type=type, t=time.time())])[-80:]

    def _start_countdown(self, now):
        self._clear_round()
        self.round_id += 1
        every = config.SPEED_ROUND_EVERY
        self.round_type = "speed" if every and self.round_id % every == 0 else "normal"
        self.round_lang, self.round_level = self.lang, self.level
        used = self.used.setdefault(self.lang, set())
        item = self._take_custom()
        if item and item.get("host"):                # the host's own word (room page): nobody to name
            self.round_level = 2
            self.secret = item["word"]
        elif item:                                   # a viewer's word: always the normal dictionary
            self.round_level = 2
            self.secret = item["word"]
            sid = item["tiktok_id"].lower()                 # the nickname now, not as it was when picked
            self.setter = {"id": sid, "name": getattr(self, "names", {}).get(sid) or item["name"], "cid": item["id"]}
            self.played_custom.append(item["id"])
        else:
            nxt, self.next_pick = self.next_pick, None
            if nxt and nxt[:2] == (self.lang, self.level) and nxt[2] not in used and nxt[2] in self.sem.index:
                self.secret, self.tier = nxt[2], nxt[3]         # picked at the end of the last round
            else:
                self.secret, self.tier = self._pick_secret(self.sem, self.lang)
        used.add(self.secret)
        self.store.save(self.USED, {k: sorted(v) for k, v in self.used.items()})
        rank = self.ranks.pop((self.dict_key(self.round_lang, self.round_level), self.secret), None)
        if rank is not None and len(rank) == self.sem.size:     # prepared by the ranker Lambda in the break
            self.rank, self.order = rank, np.argsort(rank, kind="stable")
            self.rank_source = "lambda"
        else:
            self.rank, self.order = self.sem.ranking(self.secret)
            self.rank_source = "local"
        self.ranks.clear()
        self.phase = COUNTDOWN
        self.phase_until = now + config.COUNTDOWN_SEC
        self.emit("countdown", round=self.round_id, roundType=self.round_type)
        print(f"[guess] round {self.round_id} ({self.round_type}, {self.tier}), "
              f"secret has {len(self.secret)} letters, table: {self.rank_source}")

    def _start_playing(self, now):
        self.phase = PLAYING
        dur = config.SPEED_ROUND_DURATION if self.round_type == "speed" else self.round_sec
        self.started_at, self.ends_at = now, now + dur
        self.emit("round_start", round=self.round_id, roundType=self.round_type, duration=dur)
        if self.setter:
            self.setter_t = now
            self.emit("custom_word", name=self.setter["name"])

    def _next_tier(self):
        """Dynamic difficulty: quick wins -> harder words, nobody close -> easier."""
        if not config.DYNAMIC_DIFFICULTY or not self.difficulty:
            return self.tier
        tiers = ["easy", "medium", "hard"]
        i = tiers.index(self.tier) if self.tier in tiers else 0
        last = self.difficulty[-2:]
        if len(last) == 2 and all(solved and secs < 45 for solved, secs, _ in last):
            i = min(i + 1, 2)
        elif not last[-1][0] and last[-1][2] > 300:
            i = max(i - 1, 0)
        return tiers[i]

    def _finish(self, now, reason, player=None, hide=False):
        """PLAYING -> WINNER. reason: exact | timeout | skip. Atomic by construction. hide: the word stays secret."""
        if self.phase != PLAYING:
            return
        if self.frozen is not None:                  # paused by the host: the round ends, the pause too
            self.host_resume(now)
        self.phase = WINNER
        self.finished_at = now
        self.phase_until = now + config.WINNER_SEC
        if reason != "exact":                        # nobody found it: no winner, the day's wins don't change
            self.emit("timeout", reason=reason)
            player = None
            self.word_hidden = bool(self.setter) or hide
            if self.setter:                              # the picker earns a hint, the bot keeps the word for them
                self.add_credits(self.setter["id"], 1)
                self.unguessed_custom.append({"id": self.setter.get("cid", ""), "tiktok_id": self.setter["id"],
                                              "word": self.secret, "lang": self.round_lang})
        self.podium = self._podium()
        podium_ids = [p["id"] for p in self.podium]
        streak = self.stats.round_finished(self.players.values(),
                                           player.id if player else None, podium_ids)
        self.stats.save()
        if player:
            self.winner = {"id": player.id, "name": player.name, "avatar": player.avatar,
                           "word": self.secret.upper(), "reason": reason,
                           "seconds": round(now - self.started_at), "guesses": player.guesses,
                           "best": player.best, "streak": streak}
        stolen = bool(player) and player.id == self.stolen_by          # won with a "steal the win" gift
        self.emit("winner", reason=reason, word=self._shown_word(), stolen=stolen,
                  name=player.name if player else None,
                  avatar=player.avatar if player else "", streak=streak)
        if player and streak >= 2:
            self.emit("streak", name=player.name, n=streak)
        best_rank = min((p.best for p in self.players.values() if p.best), default=10**9)
        self.difficulty = (self.difficulty + [(reason == "exact", now - self.started_at, best_rank)])[-5:]
        self.history = (self.history + [{
            "round": self.round_id, "type": self.round_type, "tier": self.tier,
            "word": self.secret, "reason": reason, "winner": player.name if player else None,
            "seconds": round(now - self.started_at), "players": len(self.players),
            "guesses": sum(p.guesses for p in self.players.values()), "at": int(now),
            "podium": [p["name"] for p in self.podium],
            "setter": self.setter["name"] if self.setter else None, "hidden": self.word_hidden,
            "stolen": bool(player) and player.id == self.stolen_by,
            "top": self._top_guesses(20),                 # for the host's /history in the bot
            "winner_words": self._words_of(player, 20) if player else []}])[-300:]
        self.store.save(self.ROUNDS, self.history)
        # the next word, picked now: its table comes in the break
        self.next_pick = (self.lang, self.level) + tuple(self._pick_secret(self.sem_for(self.lang, self.level), self.lang))
        print(f"[guess] round {self.round_id} {reason}: word={self.secret} "
              f"winner={player.name if player else '-'}")

    def _podium(self):
        out, seen = [], set()
        for pid in self.exact_order:
            if pid in self.players and pid not in seen:
                out.append(self.players[pid]); seen.add(pid)
        rest = [p for p in self._ranked(confirmed_only=True) if p.id not in seen]
        out += rest
        return [{"id": p.id, "name": p.name, "avatar": p.avatar, "rank": p.best}
                for p in out[:3]]

    # ------------------------------------------------------------------ guesses
    def on_comment(self, viewer: Viewer, text: str, ts=None):
        cmd = " ".join(re.sub(r"[^\w\s]", " ", (text or "").lower().replace("ё", "е")).split())
        if cmd in MY_HINTS_WORDS:                        # "мои подсказки": never a guess
            if account_id(viewer.id) in self.credits_ever:
                n = self.credits.get(account_id(viewer.id), 0)
                self.emit("credits_info", name=viewer.name, avatar=viewer.avatar, n=n)
                print(f"[guess] {viewer.name} asked for their hints: {n}")
            return
        if cmd in MAO_CALL_WORDS:                        # "мао внимание": never a guess
            self.call_host(viewer)
            return
        if self.setter and (viewer.id or "").lower() == self.setter["id"] and self.phase in (COUNTDOWN, PLAYING):
            return                                       # who picked the word can't guess it
        if self.frozen is not None:                      # paused by the host: no guesses
            return
        if not self.sem or self.phase not in (PLAYING, WINNER) or self.rank is None:
            return
        now = time.time()
        # "подсказка" / "hint" (any language, any case) from a viewer with hints on account
        if self.phase == PLAYING and self.credits.get(account_id(viewer.id), 0) > 0                 and (text or "").strip(" !.?").lower().replace("ё", "е") in HINT_WORDS                 and not (ts and ts < self.started_at - 3):
            self.use_credit(viewer, now)
            return
        # stream champions (1st-3rd place by wins, ties included) and round champions (whoever named
        # the 1st, 2nd and 3rd word of the table first) may send up to 3 words at once: each word
        # counts as their own guess. At the start of a round, until three players hold the round
        # champion places, anyone may.
        round_champs = self._round_champion_ids() if self.phase == PLAYING else set()
        if self.phase == PLAYING and self._batch is None and (len(round_champs) < 3 or viewer.id in self.multi_ids
                                      or viewer.id in self.boost_ids
                                      or viewer.id in round_champs
                                      or viewer.id in self.stats.champion_ids()):
            several = self.sem.split_words(text)
            if several:
                # the words go out as one "multi_guess" event: one row (all words + the nick), then
                # each word flies to its place in the table
                self._batch = []
                try:
                    for w in several:
                        self.on_comment(viewer, w, ts)
                    batch = self._batch
                finally:
                    self._batch = None
                if len(batch) > 1:
                    self.emit("multi_guess", name=viewer.name, avatar=viewer.avatar, words=batch)
                elif batch:
                    b = batch[0]
                    if b["unknown"]:
                        self.emit("unknown", word=b["word"], name=viewer.name, avatar=viewer.avatar)
                    else:
                        self.emit("guess", word=b["word"], rank=b["rank"], temp=b["temp"], name=viewer.name,
                                  avatar=viewer.avatar, count=b["count"])
                return
        word, raw = self.sem.normalize(text)
        if raw is not None and ts and self.phase == PLAYING and ts < self.started_at - 3:
            # typed before this round started (break / countdown) but delivered late by TikTok
            print(f"[guess] rejected (sent {self.started_at - ts:.0f}s before the round) {viewer.name}: {raw}")
            return
        if raw is None:
            return                                       # ordinary chat, not a guess
        if self.phase == WINNER:                         # late exact guesses -> podium only
            if word == self.secret and now - self.finished_at <= EXACT_WINDOW_SEC \
                    and viewer.id not in self.exact_order:
                p = self.players.setdefault(viewer.id, RoundPlayer(viewer.id, viewer.name, viewer.avatar))
                p.best, p.best_t = 1, now
                self.exact_order.append(viewer.id)
                self.podium = self._podium()
                self.dirty = True
            return
        if word is None:
            if self._batch is not None:                  # part of several words: shown greyed in their row
                self._batch.append({"word": raw.upper(), "unknown": True})
                print(f"[guess] rejected (unknown) {viewer.name}: {raw}")
                return
            if now - self.unknown_t > 1.0:               # throttle the toast
                self.unknown_t = now
                self.emit("unknown", word=raw.upper(), name=viewer.name, avatar=viewer.avatar)
            print(f"[guess] rejected (unknown) {viewer.name}: {raw}")
            return
        if self.fans_only and viewer.fan < self.fan_min \
                and viewer.id.lower() != getattr(self, "host_id", config.TIKTOK_USERNAME.lower()):
            if now - self.fans_note_t.get(viewer.id, 0) > FANS_NOTE_SEC:
                self.fans_note_t[viewer.id] = now
                self.emit("fans_only", name=viewer.name, n=self.fan_min)
            print(f"[guess] rejected (not in the team from level {self.fan_min}, has {viewer.fan}) {viewer.name}: {word}")
            return
        p = self.players.get(viewer.id)
        if p is None:
            p = self.players[viewer.id] = RoundPlayer(viewer.id, viewer.name, viewer.avatar)
        p.name, p.avatar = viewer.name, viewer.avatar or p.avatar
        if self._needs_follow(viewer):
            if p.dq:                                     # out until they follow
                if now - p.dq_note_t > 10:
                    p.dq_note_t = now
                    self.emit("follow_needed", name=p.name, avatar=p.avatar, dq=True)
                print(f"[guess] rejected (not following) {viewer.name}: {word}")
                return
            if not p.pending_until:
                p.pending_until = now + self.follow_grace
                self.emit("follow_needed", name=p.name, avatar=p.avatar, dq=False,
                          seconds=self.follow_grace)
                print(f"[guess] {viewer.name} is not following: {self.follow_grace}s to follow")
        elif viewer.follows > 0 and (p.pending_until or p.dq):
            self._confirm(p, now)                        # their newer comments show them following
        if word in p.words:
            return                                       # same word again: ignore (no pause between words)
        self._accept(p, word, now)

    def _accept(self, p, word, now):
        r = int(self.rank[self.sem.index[word]])
        self.guess_times.append(now)
        p.last_t = now
        p.words.add(word)
        p.guesses += 1
        self.stats.get(p.id, p.name, p.avatar)["guesses"] += 1

        g = self.guesses.get(word)
        if g is None and len(self.guesses) < MAX_WORDS:
            g = self.guesses[word] = {"word": word, "rank": r, "count": 0, "name": p.name,
                                      "avatar": p.avatar, "t": now}
        if g is not None:
            g["count"] += 1
            g["last"], g["last_avatar"], g["last_id"] = p.name, p.avatar, p.id
            if p.name != g["name"]:
                self.flips.append(now + LAST_NAMER_SEC + 0.2)
            ids = g.setdefault("ids", [])
            if p.id not in ids and len(ids) < 50:
                ids.append(p.id)
            g["t"] = now
            if word in self.recent:
                self.recent.remove(word)
            self.recent.appendleft(word)
        temp = temperature(r)
        if self._batch is not None:
            self._batch.append({"word": word.upper(), "rank": r, "temp": temp, "count": g["count"] if g else 1,
                                "unknown": False})
        else:
            self.emit("guess", word=word.upper(), rank=r, temp=temp, name=p.name,
                      avatar=p.avatar, count=g["count"] if g else 1)
        print(f"[guess] {p.name}: {word} #{r} {temp}")

        if not p.best or r < p.best:
            prev = p.best
            p.prev, p.best, p.best_t, p.best_word = prev, r, now, word
            if prev:
                p.improvements += 1
                if prev >= 100 and r * 10 <= prev:
                    self.emit("jump", kind="massive", name=p.name, avatar=p.avatar, frm=prev, to=r)
                elif prev >= 30 and r * 3 <= prev:
                    self.emit("jump", kind="big", name=p.name, avatar=p.avatar, frm=prev, to=r)
            for bound, level in CLOSE_LEVELS:
                if 1 < r <= bound and bound < p.tier:
                    p.tier = bound
                    self.emit("close", level=level, name=p.name, avatar=p.avatar, rank=r)
                    break
            self._update_leader()
        if r == 1:
            if p.pending_until:                          # found it, but must follow to win
                p.found_exact = True
                self.emit("found_pending", name=p.name, avatar=p.avatar,
                          seconds=max(1, round(p.pending_until - now)))
            else:
                self.exact_order.append(p.id)
                self._finish(now, "exact", p)
        self.dirty = True

    def _ranked(self, confirmed_only=False):
        return sorted((p for p in self.players.values()
                       if p.best and not p.dq and not (confirmed_only and p.pending_until)),
                      key=lambda p: (p.best, p.best_t))

    def _needs_follow(self, viewer):
        return (self.follow_required and viewer.follows == 0
                and viewer.id.lower() != getattr(self, "host_id", config.TIKTOK_USERNAME.lower()))

    def _confirm(self, p, now):
        """Player followed: keep their place (or get it back)."""
        p.pending_until, p.dq = 0.0, False
        self.emit("follow_ok", name=p.name, avatar=p.avatar)
        print(f"[guess] {p.name} followed -> counts")
        self._update_leader()
        if p.found_exact and self.phase == PLAYING:
            self.exact_order.append(p.id)
            self._finish(now, "exact", p)
        self.dirty = True

    def _update_leader(self):
        ranked = self._ranked()
        if not ranked or ranked[0].id == self.leader_id:
            return
        new, prev = ranked[0], self.players.get(self.leader_id)
        self.leader_id = new.id
        if prev is not None and new.best > 1:
            self.emit("new_leader", name=new.name, avatar=new.avatar, rank=new.best,
                      prev=prev.name, comeback=new.id in self.past_leaders)
        self.past_leaders.add(new.id)

    # ------------------------------------------------------------------ hints / gifts
    def give_hint(self, source, now=None, viewer=None):
        """Auto hints rotate types and respect a cooldown. A gift hint (viewer given) is always
        a close word, has no cooldown, and that word counts as the gifter's own guess."""
        now = now or time.time()
        if self.phase != PLAYING or not self.secret or self.rank is None:
            return None
        if viewer is None and now - self.last_hint_t < config.HINT_COOLDOWN_SEC:
            return None
        if viewer is not None:
            # a paid hint is always closer than the best guess; if only the secret is closer
            # (best is #2), the hint IS the secret and the gifter wins
            h = hints.semantic(self, sum(1 for x in self.hints if x["type"] == "semantic")) or \
                {"type": "semantic", "text": "A word close to the secret word is:", "word": self.secret.upper()}
        else:
            h = hints.make_hint(self, config.HINT_TYPES)
        if not h:
            return None
        h["by"] = source
        self.hints.append(h)
        self.last_hint_t = now
        self.emit("hint", kind=h["type"], text=h["text"], word=h["word"], n=h.get("n"), by=source)
        print(f"[guess] hint ({h['type']}) by {source}")
        word = h["word"].lower()
        if viewer is not None and h["type"] == "semantic" and word in self.sem.index:
            p = self.players.get(viewer.id)
            if p is None:
                p = self.players[viewer.id] = RoundPlayer(viewer.id, viewer.name, viewer.avatar)
            if word not in p.words:
                self._accept(p, word, now)               # the hint word is their guess
        return h

    def on_gift(self, viewer: Viewer, gift: str, count: int, repeat=False, actions=None):
        """repeat: more gifts of a combo whose start was already handled - thanked once, per combo.
        actions: what this gift triggers by the streamer's gift rules ("hint", "multi", ...);
        None (no rules given) = the old behaviour: any gift gives a hint."""
        if not repeat:
            self.emit("gift", name=viewer.name, avatar=viewer.avatar, gift=gift, count=count)
        print(f"[guess] gift {gift} x{count} from {viewer.name}" + (" (combo)" if repeat else "")
              + (f" -> {sorted(actions)}" if actions else ""))
        if actions is None:
            actions = {"hint"}
        if "steal" in actions and self.phase == PLAYING and not repeat:
            if self.setter and (viewer.id or "").lower() == self.setter["id"]:
                print(f"[guess] {viewer.name}: no stealing their own word")
            else:
                self._steal(viewer)
                return
        if "boost" in actions and viewer.id not in self.boost_ids:
            self.boost_ids.add(viewer.id)                # 3 words in one comment till the stream ends
            self.store.save(self.BOOSTS, sorted(self.boost_ids))
            self.emit("boost", name=viewer.name, avatar=viewer.avatar)
            print(f"[guess] {viewer.name} may send 3 words till the stream ends (gift)")
        if "multi" in actions and self.phase == PLAYING and viewer.id not in self.multi_ids:
            self.multi_ids.add(viewer.id)                # 3 words in one comment until the round ends
            print(f"[guess] {viewer.name} may send 3 words this round (gift)")
        if "hint" in actions:
            # one hint now (unless this viewer had one less than hint_cd s ago), every other gift
            # of the combo goes on their account: spent later with "подсказка", one at a time
            n, now = max(1, int(count or 1)), time.time()
            self._mark_credit_account(viewer.id)         # a gifter has a hint account, even at 0
            if self._hint_wait(viewer, now) == 0 and self.give_hint(viewer.name, now, viewer=viewer):
                self.hint_t[viewer.id] = now
                n -= 1
            if n:
                self.add_credits(viewer.id, n)

    def manual_action(self, viewer, action):
        """the streamer does a gift's action for a viewer (room page): -> done or not"""
        now = time.time()
        if action == "hint":
            self._mark_credit_account(viewer.id)
            if self.phase == PLAYING and self._hint_wait(viewer, now) == 0 and self.give_hint(viewer.name, now, viewer=viewer):
                self.hint_t[viewer.id] = now
            else:
                self.add_credits(viewer.id, 1)           # not now: on their account
            return True
        if action == "multi" and self.phase == PLAYING:
            self.multi_ids.add(viewer.id)
            return True
        if action == "boost":
            if viewer.id not in self.boost_ids:
                self.boost_ids.add(viewer.id)
                self.store.save(self.BOOSTS, sorted(self.boost_ids))
                self.emit("boost", name=viewer.name, avatar=viewer.avatar)
            return True
        if action == "steal" and self.phase == PLAYING and not (self.setter and viewer.id.lower() == self.setter["id"]):
            self._steal(viewer)
            return True
        return False

    def _steal(self, viewer):
        """"steal the win" gift: the gifter wins the round at once with the word - nobody can get ahead,
        the round ends right here (follow / pending rules don't hold a paid win back)"""
        now = time.time()
        p = self.players.setdefault(viewer.id, RoundPlayer(viewer.id, viewer.name, viewer.avatar))
        p.name, p.avatar = viewer.name, viewer.avatar or p.avatar
        p.pending_until, p.dq = 0.0, False
        self.emit("steal", name=p.name, avatar=p.avatar)
        print(f"[guess] {p.name} stole the win (gift): {self.secret}")
        p.words.discard(self.secret)
        self.stolen_by = p.id
        try:
            self._accept(p, self.secret, now)
        finally:
            self.stolen_by = None

    # ------------------------------------------------------------------ hint credits
    def add_credits(self, viewer_id, n=1):
        """Put hints on a viewer's account (gift-free hints they spend with "подсказка")."""
        viewer_id = account_id(viewer_id)
        if not viewer_id:
            return 0
        left = max(0, self.credits.get(viewer_id, 0) + int(n))
        if int(n) > 0:
            self._mark_credit_account(viewer_id)
        if left:
            self.credits[viewer_id] = left
        else:
            self.credits.pop(viewer_id, None)
        self.store.save(self.CREDITS, self.credits)
        print(f"[guess] hint credits {viewer_id}: {left}")
        return left

    def _mark_credit_account(self, viewer_id):
        """Remember that this viewer has a hint account ("мои подсказки" answers them, even with 0)."""
        viewer_id = account_id(viewer_id)
        if viewer_id and viewer_id not in self.credits_ever:
            self.credits_ever.add(viewer_id)
            self.store.save(self.CREDITS_EVER, sorted(self.credits_ever))

    def _hint_wait(self, viewer, now):
        """Seconds this viewer still has to wait for their next hint (0 = now)."""
        return max(0, self.hint_t.get(viewer.id, 0) + self.hint_cd - now)

    def use_credit(self, viewer, now=None):
        now = now or time.time()
        wait = self._hint_wait(viewer, now)
        if wait > 0:                                     # too soon: the credit stays on the account
            self.emit("hint_wait", name=viewer.name, avatar=viewer.avatar, seconds=int(wait) + 1)
            print(f"[guess] {viewer.name}: next hint in {int(wait) + 1}s")
            return None
        h = self.give_hint(viewer.name, now, viewer=viewer)
        if h:
            self.hint_t[viewer.id] = now
            left = self.add_credits(viewer.id, -1)
            print(f"[guess] {viewer.name} used a hint credit ({left} left)")
        return h

    def on_follow(self, viewer: Viewer):
        self.stats.follows += 1
        self.emit("follow", name=viewer.name, avatar=viewer.avatar)
        p = self.players.get(viewer.id)
        if p and (p.pending_until or p.dq):
            self._confirm(p, time.time())

    # ------------------------------------------------------------------ lifecycle
    def on_activate(self):
        now = time.time()
        if self.restore_wait:                             # resumes when the table comes (put_ranking)
            self.resume_on_table = True
            self.dirty = True
            return
        if self.paused_at:                                # resume timers where they stopped
            shift = now - self.paused_at
            self.started_at += shift
            self.ends_at += shift
            self.phase_until += shift
            for p in self.players.values():
                if p.pending_until:
                    p.pending_until += shift
            self.paused_at = None
        self.dirty = True

    def on_deactivate(self):
        self.paused_at = time.time()

    def new_session(self):
        self.stats.reset()
        self.stats.save()
        self.boost_ids = set()                                # a new stream: the boosts are over
        self.store.save(self.BOOSTS, [])
        self.round_id = 0
        self.difficulty = []
        self.tier = "easy"
        self._clear_round()
        self.phase = IDLE
        # a round restored at start and waiting for its table is gone: don't stay paused waiting for it
        self.restore_wait = self.resume_on_table = False
        self.paused_at = None
        self.dirty = True

    def set_option(self, key, value):
        if key == "break":                               # old on/off switch
            key, value = "pause", (config.WINNER_SEC + config.REVEAL_SEC) if value else 0
        if key == "pause":
            self.pause_sec = max(0, int(value))
            if self.phase == REVEAL and now_past(self.finished_at + self.pause_sec):
                self.phase = FINISHED                    # shortened during a break
            elif self.phase == REVEAL:
                self.phase_until = self.finished_at + self.pause_sec
        elif key == "round_min":
            self.round_sec = max(60, int(value) * 60)    # from the next round
        elif key == "follow":                            # 2 the team only, 1 followers only, 0 all
            self.fans_only = int(value) == 2
            self.follow_required = int(value) >= 1
        elif key == "fan_min":
            self.fan_min = int(value)
        elif key == "grace":
            self.follow_grace = int(value)
        elif key == "hint_cd":
            self.hint_cd = int(value)
        elif key == "chroma":
            self.chroma = bool(value)
        elif key == "chroma_top" and int(value) in self.OPTIONS["chroma_top"]:
            self.chroma_top = int(value)
        elif key == "frame" and float(value) in self.OPTIONS["frame"]:
            self.frame = float(value) if float(value) % 1 else int(value)
        elif key == "row_anim" and float(value) in self.OPTIONS["row_anim"]:
            self.row_anim = float(value) if float(value) % 1 else int(value)
        elif key == "chat_zone" and int(value) in self.OPTIONS["chat_zone"]:
            self.chat_zone = int(value)
        elif key == "level" and int(value) in self.OPTIONS["level"]:
            self.level = int(value)                      # from the next round
        self.dirty = True

    def get_options(self):
        return {"pause": self.pause_sec, "round_min": self.round_sec // 60,
                "follow": 2 if self.fans_only else int(self.follow_required), "grace": int(self.follow_grace),
                "fan_min": self.fan_min,
                "level": self.level, "hint_cd": self.hint_cd,
                "chroma": int(self.chroma), "chroma_top": self.chroma_top, "frame": self.frame, "chat_zone": self.chat_zone,
                "row_anim": self.row_anim}

    @property
    def reveal_sec(self):
        """Part of the break after the winner card: results, then promo."""
        return max(0, self.pause_sec - config.WINNER_SEC)

    @property
    def sem(self):
        lang = self.round_lang if self.round_lang in self.sems else self.lang
        return self.sems.get(self.dict_key(lang, self.round_level))    # round_level = self.level from the next countdown on

    def set_lang(self, lang):
        """Switch the word language: the current round is dropped and a new one starts."""
        if lang == self.lang or lang not in self.sems:
            return
        self.lang = lang
        if self.phase in (COUNTDOWN, PLAYING) and self.round_lang != lang:
            self._clear_round()
            self.phase = IDLE
        self.dirty = True
        print(f"[guess] language -> {lang}")

    def tick(self, now):
        if self.frozen is not None:                      # the host paused the game: timers stand still
            return
        if self.pause_after and self.phase in (IDLE, FINISHED) and self.round_id >= self.pause_after:
            self.pause_after = 0                         # the break the host asked for, after that round
            self.host_pause(now)
            return
        if self.paused_at:
            # only the active game ticks, and the active game is never meant to stay paused: a safety net
            # for bugs like a restored round waiting for a table that never comes - after STUCK_PAUSE_SEC
            # the round is dropped and a new one starts
            if not self.stuck_since:
                self.stuck_since = now
            elif now - self.stuck_since > STUCK_PAUSE_SEC:
                print(f"[guess] WARNING: paused {now - self.stuck_since:.0f}s while active "
                      f"(restore_wait={self.restore_wait}, phase={self.phase}) -> the round is dropped, a new one starts")
                self._clear_round()
                self.phase = IDLE
                self.restore_wait = self.resume_on_table = False
                self.paused_at = None
                self.stuck_since = 0.0
                self.dirty = True
            return
        self.stuck_since = 0.0
        if not self.sem:
            return
        if self.phase in (IDLE, FINISHED):
            if not self._table_ready():                  # no embeddings here: wait for the ranker Lambda
                if not self.waiting_since:
                    self.waiting_since = now
                    print("[guess] waiting for the next round's table from the ranker")
                return
            if self.waiting_since:
                print(f"[guess] table came after {now - self.waiting_since:.0f}s of waiting")
                self.waiting_since = 0.0
            self._start_countdown(now)
        elif self.phase == COUNTDOWN and now >= self.phase_until:
            self._start_playing(now)
        elif self.phase == PLAYING:
            while self.flips and now >= self.flips[0]:   # a row goes back to its first namer: re-render
                self.flips.popleft()
                self.dirty = True
            for p in list(self.players.values()):
                if p.pending_until and now >= p.pending_until:
                    p.pending_until, p.dq = 0.0, True
                    self.emit("dq", name=p.name, avatar=p.avatar, found=p.found_exact)
                    print(f"[guess] {p.name} didn't follow in time -> removed from TOP")
                    if self.leader_id == p.id:
                        self.leader_id = None
                    self._update_leader()
                    self.dirty = True
            if self.setter and now - self.setter_t >= SETTER_TICKER_SEC:
                self.setter_t = now
                self.emit("custom_ticker", name=self.setter["name"])
            if now >= self.ends_at:
                self._finish(now, "timeout")
            elif config.AUTO_HINT and not self.auto_hint_done and \
                    now - self.started_at > 0.55 * (self.ends_at - self.started_at):
                best = min((p.best for p in self.players.values() if p.best), default=10**9)
                self.auto_hint_done = True
                if best > 300:
                    self.give_hint("auto", now)
        elif self.phase == WINNER and now >= self.phase_until:
            if not self.reveal_sec:                      # no break: winner card, then next round
                self.phase = FINISHED
                self.dirty = True
                return
            self.phase = REVEAL
            self.phase_until = now + self.reveal_sec
            self.emit("reveal", word=self._shown_word())
        elif self.phase == REVEAL and now >= self.phase_until:
            self.phase = FINISHED
            self.dirty = True

    # ------------------------------------------------------------------ simulation / debug
    def simulate_step(self):
        if self.phase != PLAYING or self.rank is None:       # no table yet (waiting for the ranker)
            return 0.5
        now = time.time()
        progress = (now - self.started_at) / max(1, self.ends_at - self.started_at)
        name = random.choice(SIM_NAMES)
        follows = 0 if name in ("Noah", "Mia") else 1          # two fake non-followers
        v = Viewer(name.lower(), name, "", follows)
        p = self.players.get(v.id)
        if p and p.pending_until and random.random() < 0.08:    # some of them do follow
            self.on_follow(v)
            return 0.5
        roll = random.random()
        if roll < 0.03:
            self.on_gift(v, random.choice(["Rose", "Heart", "GG"]), random.randint(1, 5))
        elif roll < 0.05:
            self.on_comment(v, random.choice(["qwzx", "blorp", "zzzt"]))
        elif roll < 0.06:
            self.on_follow(v)
        else:
            hi = math.log(self.sem.size) * (1 - 0.75 * progress)
            r = max(1, int(math.exp(random.uniform(math.log(1.6), max(1.0, hi)))))
            if r == 1 and progress < 0.35:
                r = 2 + random.randint(0, 5)
            self.on_comment(v, self.sem.words[int(self.order[min(r, self.sem.size) - 1])])
        return random.uniform(0.25, 0.9)

    def debug(self, action, params):
        now = time.time()
        name = (params.get("name") or "Tester")[:30]
        v = Viewer(name.lower(), name, "")
        if action == "credit":                           # hints on account: {"id": "nick", "n": 1}
            return {"id": params.get("id"), "credits": self.add_credits(params.get("id"), params.get("n", 1)),
                    "all": self.credits}
        if action == "start_round":
            if self.phase == PLAYING:
                self._finish(now, "skip")
            else:
                self._start_countdown(now)
        elif action == "finish_round":
            self._finish(now, "timeout")
        elif action == "force_winner":
            if self.phase == PLAYING:
                p = self.players.setdefault(v.id, RoundPlayer(v.id, v.name))
                self._accept(p, self.secret, now)
        elif action == "follow":
            self.on_follow(v)
        elif action == "send_guess":
            if str(params.get("follows", "")).strip() in ("0", "false", "no"):
                v.follows = 0
            self.on_comment(v, params.get("word", ""))
        elif action == "send_gift":
            self.on_gift(v, params.get("gift") or "Rose", 1)
        elif action == "hint":
            self.last_hint_t = 0
            return {"hint": self.give_hint(name, now, viewer=v)}
        elif action == "trigger_new_leader":
            self.emit("new_leader", name=name, avatar="", rank=17, prev="Mike", comeback=False)
        elif action == "trigger_massive_jump":
            self.emit("jump", kind="massive", name=name, avatar="", frm=4210, to=37)
        elif action == "trigger_close_guess":
            self.emit("close", level=params.get("level") or "so_close", name=name, avatar="", rank=2)
        elif action == "trigger_streak":
            self.emit("streak", name=name, n=int(params.get("n") or 3))
        elif action == "secret":
            return {"secret": self.secret, "phase": self.phase}
        elif action == "reset":
            self.new_session()
        else:
            return super().debug(action, params)
        return {"ok": True}

    # ------------------------------------------------------------------ public state
    def _row(self, g):
        temp = temperature(g["rank"])
        # who named it last shows for LAST_NAMER_SEC, then the one who named it first again
        last = bool(g.get("last")) and g["last"] != g["name"] and time.time() - g.get("t", 0) < LAST_NAMER_SEC
        p = self.players.get(g.get("last_id") if last else (g.get("ids") or [None])[0])
        return {"word": g["word"].upper(), "rank": g["rank"], "temp": temp, "tempKey": temp_key(temp),
                "count": g["count"], "name": g["last"] if last else g["name"], "first": g["name"],
                "avatar": g.get("last_avatar", g["avatar"]) if last else g["avatar"],
                "pendingUntil": p.pending_until if p and p.pending_until else 0}

    def call_host(self, viewer, now=None):
        """A leader of the day (stream champion) or of the round calls the host: red ticker + voice x3."""
        now = now or time.time()
        if viewer.id not in self.stats.champion_ids() and viewer.id not in self._round_champion_ids():
            return False
        if now - self.mao_call_t < MAO_CALL_SEC:
            print(f"[guess] {viewer.name} calls Mao: too soon")
            return False
        self.mao_call_t = now
        self.emit("mao_call", name=viewer.name, avatar=viewer.avatar)
        print(f"[guess] {viewer.name} calls Mao")
        return True

    # ------------------------------------------------------------------ next round's table (ranker Lambda)
    def dict_key(self, lang, level):
        """name of the dictionary (assets folder) used for a language + level; a language without a hard
        dictionary (all but Russian) plays its normal one on level 3"""
        easy, hard = lang + "-easy", lang + "-hard"
        if level == 1 and easy in self.sems:
            return easy
        if level == 3 and hard in self.sems:
            return hard
        return lang if lang in self.sems else easy

    def sem_for(self, lang, level):
        return self.sems[self.dict_key(lang, level)]

    def planned_next(self):
        """(dict, word, vocab hash) whose ranking the game needs next, or None"""
        if self.restore_wait and self.secret:          # the restored round's own table
            key = self.dict_key(self.round_lang, self.round_level)
            return key, self.secret, self.sems[key].vocab_hash
        if self.phase not in (IDLE, WINNER, REVEAL, FINISHED):
            return None
        for c in self.custom:                         # a viewer's word goes first (normal dictionary)
            if c["lang"] == self.lang and c["word"] in self.sem_for(self.lang, 2).index:
                key = self.dict_key(self.lang, 2)
                return key, c["word"], self.sems[key].vocab_hash
        used = self.used.get(self.lang, set())
        if not self.next_pick or self.next_pick[:2] != (self.lang, self.level) or self.next_pick[2] in used:
            self.next_pick = (self.lang, self.level) + tuple(self._pick_secret(self.sem_for(self.lang, self.level), self.lang))
        key = self.dict_key(self.lang, self.level)
        return key, self.next_pick[2], self.sems[key].vocab_hash

    def _fresh_words(self, sem, lang):
        """how many words of the dictionary's pools the game hasn't picked yet"""
        used = self.used.get(lang, set())
        return sum(1 for p in sem.pools.values() for w in p if w not in used and w in sem.index)

    def _pick_secret(self, sem, lang):
        """(word, tier): any word never picked before, all of them alike (common and rare); all of them played ->
        a new cycle (the list starts anew)"""
        used = self.used.setdefault(lang, set())
        fresh = [(w, t) for t, pool in sem.pools.items() for w in pool if w not in used and w in sem.index]
        if not fresh:
            print(f"[guess] every word of the {lang} dictionary has been played ({len(used)}): a new cycle")
            used.clear()
            self.store.save(self.USED, {k: sorted(v) for k, v in self.used.items()})
            fresh = [(w, t) for t, pool in sem.pools.items() for w in pool if w in sem.index]
        return random.choice(fresh)

    def _table_ready(self):
        plan = self.planned_next()
        return not plan or plan[:2] in self.ranks or self.sems[plan[0]].emb is not None

    def put_ranking(self, key, word, rank):
        rank = np.asarray(rank, dtype=np.int32)
        if self.restore_wait and word == self.secret and key == self.dict_key(self.round_lang, self.round_level):
            self.rank, self.order = rank, np.argsort(rank, kind="stable")
            self.restore_wait = False
            print(f"[guess] round {self.round_id} restored with the ranker's table")
            if self.resume_on_table:
                self.resume_on_table = False
                self.on_activate()
            return
        self.ranks[(key, word)] = rank

    def _shown_word(self):
        """the secret for the screen; a viewer's word nobody found stays secret"""
        return self.secret.upper() if self.secret and not self.word_hidden else None

    def _last_round(self):
        if not self.history:
            return None
        lr = self.history[-1]
        return dict(lr, word=None) if lr.get("hidden") else lr

    # ------------------------------------------------------------------ words picked by viewers (bot)
    def check_custom(self, item):
        """A viewer's word from the bot: is it in the dictionary? -> (ok, dictionary word). Not queued:
        the host decides first."""
        sem = self.sems.get(self.lang) or self.sems.get(self.lang + "-easy")
        word = sem.normalize(item.get("word", ""))[0] if sem else None
        if not word:
            try:
                with open(self.store.path(self.MISSING), "a", encoding="utf-8") as f:
                    f.write(json.dumps({"at": int(time.time()), "word": item.get("word", ""), "lang": self.lang,
                                        "by": item.get("tiktok_id", "")}, ensure_ascii=False) + "\n")
            except Exception as e:
                print(f"[guess] can't log a missing word: {e}")
            print(f"[guess] {item.get('name')}'s word '{item.get('word')}' isn't in the dictionary")
            return False, None
        return True, word

    def queue_custom(self, item):
        """A word the host accepted -> (ok, dictionary word, round it will be played in)."""
        ok, word = self.check_custom(item)
        if not ok:
            return False, None, None
        self.custom.append({"id": item["id"], "word": word, "lang": self.lang, "name": item.get("name", ""),
                            "tiktok_id": item.get("tiktok_id", "")})
        self.store.save(self.CUSTOM, self.custom)
        rnd = self.round_id + len(self.custom)           # the next round is round_id + 1
        print(f"[guess] {item.get('name')} picked '{word}' for round {rnd}")
        return True, word, rnd

    def cancel_custom(self, cid):
        self.custom = [c for c in self.custom if c["id"] != cid]
        self.store.save(self.CUSTOM, self.custom)

    def _take_custom(self):
        for c in self.custom:
            if c["lang"] == self.lang and c["word"] in (self.sems.get(self.lang) or self.sem).index:
                self.custom.remove(c)
                self.store.save(self.CUSTOM, self.custom)
                return c
        return None

    # ------------------------------------------------------------------ the host's controls (room page)
    def host_pause(self, now):
        if self.frozen is not None:
            return False
        self.frozen = {"at": now, "elapsed": now - self.started_at if self.started_at else 0,
                       "ends": self.ends_at - now, "phase": self.phase_until - now}
        self.dirty = True
        return True

    def host_resume(self, now):
        f, self.frozen = self.frozen, None
        if f is None:
            return False
        if self.phase in (COUNTDOWN, PLAYING, WINNER, REVEAL):
            if self.started_at:
                self.started_at = now - f["elapsed"]
            self.ends_at, self.phase_until = now + f["ends"], now + f["phase"]
            for p in self.players.values():
                if p.pending_until:
                    p.pending_until += max(0, now - f["at"])
        self.dirty = True
        return True

    def control(self, cmd, params):
        """The host's command from the room page -> done or not (not now / unknown)."""
        now = time.time()
        if cmd == "pause":
            ok = self.host_pause(now)
        elif cmd == "resume":
            ok = self.host_resume(now)
        elif cmd == "extend":                            # +N minutes to the round
            n = max(1, min(int(params.get("min") or 5), 30))
            ok = self.phase == PLAYING
            if ok:
                self.ends_at += n * 60
                if self.frozen is not None:
                    self.frozen["ends"] += n * 60
                self.emit("extended", n=n)
        elif cmd == "hint":                              # a hint for everyone, now
            if self.frozen is not None:
                return False
            self.last_hint_t = 0
            ok = bool(self.give_hint("host", now))
        elif cmd in ("skip", "finish"):                  # end the round: the word stays secret / is shown
            ok = self.phase == PLAYING
            self._finish(now, "skip" if cmd == "skip" else "timeout", hide=cmd == "skip")
        elif cmd == "break_after":                       # a break after round N (0 = none)
            n = int(params.get("round") or 0)
            self.pause_after = n if n >= self.round_id else 0
            ok = True
        elif cmd == "queue_remove":
            n = len(self.custom)
            self.cancel_custom(params.get("id"))
            ok = len(self.custom) < n
        elif cmd == "queue_move":                        # {id, to}: its new place in the queue
            item = next((c for c in self.custom if c["id"] == params.get("id")), None)
            ok = item is not None
            if ok:
                self.custom.remove(item)
                self.custom.insert(max(0, min(int(params.get("to") or 0), len(self.custom))), item)
                self.store.save(self.CUSTOM, self.custom)
        elif cmd == "queue_add":                         # the host's own word: {word, first, tiktok_id?, name?}
            ok, word = self.check_custom({"word": params.get("word", ""), "tiktok_id": "host"})
            if not ok:
                return {"ok": False, "error": "not_in_dictionary"}
            if any(c["word"] == word and c["lang"] == self.lang for c in self.custom):
                return {"ok": False, "error": "already_queued"}
            who = account_id(params.get("tiktok_id"))   # a viewer's word sent to the host directly: theirs
            item = {"id": "host-%x" % int(now * 1000), "word": word, "lang": self.lang,
                    "name": (params.get("name") or who)[:60] if who else "", "tiktok_id": who, "host": not who, "manual": True}
            self.custom.insert(0, item) if params.get("first") else self.custom.append(item)
            self.store.save(self.CUSTOM, self.custom)
        elif cmd == "reroll":                            # another random word for the next round
            ok = bool(self.next_pick)
            if ok:
                self.used.setdefault(self.next_pick[0], set()).add(self.next_pick[2])
                self.next_pick = None
                if self.phase in (IDLE, WINNER, REVEAL, FINISHED):
                    self.planned_next()
        else:
            return False
        if ok:
            self.log = (self.log + [{"type": "host", "cmd": cmd, "t": now}])[-80:]
            self.dirty = True
            print(f"[guess] host: {cmd} {params or ''}")
        return ok

    def _stream_rounds(self):
        """the finished rounds of this stream, newest first (round numbers restart with every stream)"""
        out, prev = [], None
        for r in reversed(self.history):
            n = r.get("round") or 0
            if n > (self.round_id if prev is None else prev - 1) or n < 1:
                break
            out.append(r)
            prev = n
        return out

    def monitor(self):
        """Everything the room page's monitor shows: the round now, this stream's rounds, what's planned."""
        now = time.time()
        f = self.frozen
        names = getattr(self, "names", {})
        players = sorted(self.players.values(), key=lambda p: (not p.best, p.best or 0, p.best_t))
        top = sorted(self.guesses.values(), key=lambda g: g["rank"])[:20]
        current = {
            "round": self.round_id, "phase": self.phase, "type": self.round_type, "tier": self.tier,
            "word": (self.secret or "").upper(), "setter": self.setter["name"] if self.setter else None,
            "lang": self.round_lang, "level": self.round_level,
            "paused": f is not None, "left": max(0, round(f["ends"] if f else self.ends_at - now)),
            "elapsed": round(f["elapsed"] if f else (now - self.started_at if self.started_at else 0)),
            "duration": round(self.ends_at - self.started_at) if self.started_at else self.round_sec,
            "phaseLeft": max(0, round(f["phase"] if f else self.phase_until - now)),
            "players": len(self.players), "guesses": sum(p.guesses for p in self.players.values()),
            "pace": sum(1 for x in self.guess_times if x > now - 60),
            "top": [{"word": g["word"].upper(), "rank": g["rank"], "name": g["name"], "avatar": g["avatar"],
                     "id": (g.get("ids") or [""])[0],
                     "count": g["count"], "t": g.get("t")} for g in top],
            "people": [{"id": p.id, "name": p.name, "avatar": p.avatar, "best": p.best, "word": (p.best_word or "").upper(),
                        "guesses": p.guesses, "boost": p.id in self.boost_ids, "multi": p.id in self.multi_ids,
                        "credits": self.credits.get(account_id(p.id), 0), "pending": bool(p.pending_until), "dq": p.dq}
                       for p in players[:60]],
            "hints": [{"word": h.get("word"), "type": h.get("type"), "by": h.get("by")} for h in self.hints],
            "log": self.log[::-1][:50],
        }
        past = [{k: r.get(k) for k in ("round", "word", "setter", "winner", "reason", "stolen", "hidden", "players",
                                         "guesses", "seconds", "at", "top", "winner_words")}
                for r in self._stream_rounds()]
        queue = [{"id": c["id"], "word": c["word"].upper(), "name": c.get("name") or "", "host": bool(c.get("host")),
                  "manual": bool(c.get("manual"))}
                 for c in self.custom if c["lang"] == self.lang]
        nxt = self.next_pick if self.next_pick and self.next_pick[:2] == (self.lang, self.level) else None
        plan = {
            "queue": queue,
            "next": {"word": nxt[2].upper(), "tier": nxt[3],
                     "ready": (self.dict_key(self.lang, self.level), nxt[2]) in self.ranks} if nxt else None,
            "pause": self.reveal_sec, "roundSec": self.round_sec, "level": self.level, "lang": self.lang,
            "breakAfter": self.pause_after,
            "fresh": self._fresh_words(self.sem_for(self.lang, self.level), self.lang) if self.sems else 0,
            "credits": sorted(([names.get(k, k), n] for k, n in self.credits.items() if n > 0), key=lambda x: -x[1])[:20],
            "boosts": sorted(names.get(k.lower(), k) for k in self.boost_ids),
        }
        return {"current": current, "past": past, "plan": plan, "now": now}

    # ------------------------------------------------------------------ reports for the host (the bot)
    def _top_guesses(self, n):
        """[[WORD, rank, who named it first]] closest first."""
        rows = sorted(self.guesses.values(), key=lambda g: g["rank"])[:n]
        return [[g["word"].upper(), g["rank"], g["name"]] for g in rows]

    def _words_of(self, player, n):
        """[[WORD, rank]] a player's words this round, closest first."""
        rows = [(w, self.guesses[w]["rank"]) for w in player.words if w in self.guesses]
        return [[w.upper(), r] for w, r in sorted(rows, key=lambda x: x[1])[:n]]

    def round_report(self):
        """The current round for the host's /round: the word and who picked it, players (20), guesses, top 20."""
        players = sorted(self.players.values(), key=lambda p: (not p.best, p.best or 0, p.best_t))
        return {"round": self.round_id, "phase": self.phase, "word": (self.secret or "").upper(),
                "setter": self.setter["name"] if self.setter else None,
                "seconds": round(time.time() - self.started_at) if self.started_at else 0,
                "players": len(self.players), "guesses": sum(p.guesses for p in self.players.values()),
                "who": [[p.name, p.best, p.guesses] for p in players[:20]], "top": self._top_guesses(20)}

    def history_report(self, n):
        """The last n finished rounds (newest first) for the host's /history."""
        n = max(1, min(int(n or 1), 10))
        return [{k: r.get(k) for k in ("round", "word", "setter", "winner", "reason", "players", "guesses",
                                       "seconds", "at", "winner_words", "top")}
                for r in reversed(self.history[-n:])]

    def _round_champion_ids(self):
        """Three different players: whoever named the table's best words first, going down the table
        (if one player named the top 3, the authors of the 4th, 5th... words get the other places).
        Later namers of the same word don't count."""
        out = []
        for g in sorted((g for g in self.guesses.values() if g["rank"] > 1 and self._visible(g)),
                        key=lambda g: g["rank"]):
            first = next((i for i in g.get("ids", []) if not (self.players.get(i) and self.players[i].dq)), None)
            if first and first not in out:
                out.append(first)
            if len(out) == 3:
                break
        return set(out)

    def _visible(self, g):
        """Hide words only guessed by players removed for not following."""
        ids = g.get("ids")
        return not ids or any(not (self.players.get(i) and self.players[i].dq) for i in ids)

    def snapshot(self):
        now = time.time()
        players = self._ranked()
        reveal = self.phase in (WINNER, REVEAL, FINISHED)
        hunters = []
        for p in players[:5]:
            t = temperature(p.best)
            hunters.append({"name": p.name, "avatar": p.avatar, "rank": p.best, "temp": t,
                            "tempKey": temp_key(t), "guesses": p.guesses, "prev": p.prev,
                            "leader": p.id == self.leader_id, "pendingUntil": p.pending_until})
        best = sorted((g for g in self.guesses.values() if self._visible(g)), key=lambda g: g["rank"])
        return {
            "error": self.error,
            "phase": self.phase,
            "roundId": self.round_id,
            "roundType": self.round_type,
            "tier": self.tier,
            "startedAt": self.started_at,
            "endsAt": self.ends_at,
            "phaseUntil": self.phase_until,
            "now": now,
            "paused": bool(self.paused_at),
            "hostPaused": self.frozen is not None,
            "pausedLeft": max(0, round(self.frozen["ends"])) if self.frozen else 0,
            "secretWord": self._shown_word() if reveal else None,
            "guesses": [self._row(self.guesses[w]) for w in self.recent if w in self.guesses],
            "bestGuesses": [self._row(g) for g in best[:20] if g["rank"] > 1 or reveal],
            "topHunters": hunters,
            "leader": hunters[0] if hunters else None,
            "winner": self.winner if reveal else None,
            "podium": self.podium if reveal else [],
            "hints": self.hints,
            "stats": {"players": len(self.players),
                      "top100": sum(1 for p in players if p.best <= 100),
                      "guesses": sum(p.guesses for p in self.players.values())},
            "streamLeaderboard": self.stats.leaderboard(),
            "champions": self.stats.champions(),                          # TT mode: medals block
            "lastRound": self._last_round(),                             # for the ticker
            "chroma": self.chroma_top if self.chroma else 0,              # % of the screen, 0 = off
            "chromaTop": self.chroma_top,                                 # TT mode (?tt=1) always uses it
            "frame": self.frame,                                          # 9:frame
            "chatZone": self.chat_zone,                                   # % of the frame at the bottom: the chat
            "rowAnim": self.row_anim,                                     # s a new row slides in at the busiest
            "streak": self.stats.top_streak(),
            "vocabSize": self.sem.size if self.sem else 0,
            "temps": dict(zip(TEMPS, config.TEMPERATURE_BOUNDS + [None])),
            "subscribersOnly": config.SUBSCRIBERS_ONLY,
            "breakSec": self.reveal_sec, "resultsSec": min(config.RESULTS_SEC, self.reveal_sec),
            "promo": config.PROMO_LINES_BY_LANG.get(self.lang, config.PROMO_LINES),
            "lang": self.round_lang, "languages": sorted({k.split("-")[0] for k in self.sems}),
            "goal": {"label": config.GOAL_LABEL, "value": self.stats.follows,
                     "target": config.GOAL_TARGET} if config.GOAL_TARGET else None,
        }

    # ------------------------------------------------------------------ persistence
    def save(self):
        self.stats.save()
        self.store.save(self.STATE, {
            "phase": self.phase, "round_id": self.round_id, "round_type": self.round_type,
            "tier": self.tier, "secret": self.secret, "started_at": self.started_at,
            "ends_at": self.ends_at, "phase_until": self.phase_until,
            "guesses": self.guesses, "recent": list(self.recent),
            "players": {k: p.to_dict() for k, p in self.players.items()},
            "leader_id": self.leader_id, "past_leaders": sorted(self.past_leaders),
            "winner": self.winner, "podium": self.podium, "exact_order": self.exact_order,
            "hints": self.hints, "auto_hint_done": self.auto_hint_done,
            "finished_at": self.finished_at, "difficulty": self.difficulty,
            "saved_at": self.paused_at or time.time(), "lang": self.round_lang,
            "level": self.round_level, "next_level": self.level,
            "setter": self.setter, "setter_t": self.setter_t, "word_hidden": self.word_hidden,
            "frozen": self.frozen, "pause_after": self.pause_after,
        })

    def load(self):
        d = self.store.load(self.STATE)
        if not d or not self.sems:
            return
        try:
            if d.get("lang") in self.sems:
                self.round_lang = d["lang"]
            self.round_level = d.get("level", 1)          # rounds saved before levels: easy
            self.level = d.get("next_level", 2)
            self.round_id = d["round_id"]
            self.frozen, self.pause_after = d.get("frozen"), d.get("pause_after", 0)
            self.tier = d.get("tier", "easy")
            self.difficulty = [tuple(x) for x in d.get("difficulty", [])]
            secret = d.get("secret")
            if not secret or secret not in self.sem.index:
                return
            self.phase = d["phase"]
            self.round_type = d.get("round_type", "normal")
            self.secret = secret
            if self.sem.emb is not None:
                self.rank, self.order = self.sem.ranking(secret)
            else:                                        # the table comes from the ranker; timers wait
                self.restore_wait = True
            self.started_at, self.ends_at = d["started_at"], d["ends_at"]
            self.phase_until = d["phase_until"]
            self.guesses = d.get("guesses", {})
            self.recent = deque(d.get("recent", []), maxlen=10)
            self.players = {k: RoundPlayer.from_dict(v) for k, v in d.get("players", {}).items()}
            self.leader_id = d.get("leader_id")
            self.past_leaders = set(d.get("past_leaders", []))
            self.winner = d.get("winner")
            self.podium = d.get("podium", [])
            self.exact_order = d.get("exact_order", [])
            self.hints = d.get("hints", [])
            self.auto_hint_done = d.get("auto_hint_done", False)
            self.finished_at = d.get("finished_at", 0.0)
            self.setter, self.setter_t = d.get("setter"), d.get("setter_t", 0.0)
            self.word_hidden = d.get("word_hidden", False)
            self.paused_at = d.get("saved_at")         # timers resume on activation
            print(f"[guess] restored round {self.round_id} ({self.phase})")
        except Exception as e:
            print(f"[guess] can't restore state ({e}), starting fresh")
            self._clear_round()
            self.phase = IDLE
