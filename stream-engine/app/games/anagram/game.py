"""Anagram: the round's long word (more than 10 letters) stands at the top, letter by letter; viewers type words
of the dictionary made of its letters. The first to name a word gets a point per letter; every other viewer who
names the same word later gives its author those points again (the word's x2, x3...). Who has the most points
when the time is up wins the round; stream champions = most rounds won (like Guess the Word).

A word with a letter the round's word lacks, or with a letter used more times than it has, is shown letter by
letter (missing letters red, extra ones grey) and counts nothing; a word made of the right letters that is not in
the dictionary is shown greyed.

Round state machine (the same as Guess the Word, everything on one asyncio loop):
    IDLE -> COUNTDOWN -> PLAYING -> WINNER -> REVEAL -> FINISHED -> COUNTDOWN ...
"""

import os
import random
import re
import time
from collections import Counter

from ... import config
from ..base import BaseGame, Viewer
from ..guess.game import GuessGame
from ..guess.players import SessionStats

IDLE, COUNTDOWN, PLAYING, WINNER, REVEAL, FINISHED = (
    "idle", "countdown", "playing", "winner", "reveal", "finished")

LONG_MIN = 11                 # the round's word: more than 10 letters
MIN_LEN = 3                   # shorter words are ordinary chat, not an answer
LETTERS = {"en": "a-z", "ru": "а-я", "fr": "a-zàâæçéèêëîïôœùûüÿ", "es": "a-záéíóúüñ"}
NOTE_SEC = 0.7                # rejected answers ("no such letter", "not in the dictionary") at most this often
FOLLOW_NOTE_SEC = 30          # "follow to play" for one viewer at most this often
LOG_EVENTS = {"round_start", "winner", "timeout", "gift"}
SIM_NAMES = ["Alex", "Mike", "Sarah", "Нина", "Krestik", "фог", "Tati", "Valeria", "Сергей", "Maksim"]

_DICTS = {}                   # (assets dir, lang) -> Dictionary: one copy per process, shared by rooms


def normalize(text):
    return (text or "").strip().lower().replace("ё", "е")


class Dictionary:
    """The game's words of one language: the Guess the Word vocabulary (vocab.txt). Round words: nouns of
    LONG_MIN+ letters (valid_nouns.txt when the language has it)."""

    def __init__(self, path, lang):
        self.lang = lang
        self.letter_re = re.compile(f"[{LETTERS.get(lang, 'a-z')}]+")
        with open(os.path.join(path, "vocab.txt"), encoding="utf-8") as f:
            self.words = {normalize(w) for w in f if self.letter_re.fullmatch(normalize(w))}
        nouns = set()
        try:
            with open(os.path.join(path, "valid_nouns.txt"), encoding="utf-8") as f:
                nouns = {normalize(w) for w in f if w.strip()}
        except OSError:
            pass
        self.pool = sorted(w for w in self.words if len(w) >= LONG_MIN and (not nouns or w in nouns))

    def subwords(self, word):
        """Every dictionary word of MIN_LEN+ letters made of the word's letters (the word itself too)."""
        have = Counter(word)
        out = []
        for w in self.words:
            if MIN_LEN <= len(w) <= len(word) and all(have[c] >= n for c, n in Counter(w).items()):
                out.append(w)
        return out


def load_dicts(assets_dir):
    """{lang: Dictionary} for every language folder with a vocab.txt and long words to play."""
    out = {}
    for lang in config.LANGUAGES:
        key = (assets_dir, lang)
        if key not in _DICTS:
            path = os.path.join(assets_dir, lang)
            try:
                _DICTS[key] = Dictionary(path, lang) if os.path.isfile(os.path.join(path, "vocab.txt")) else None
            except Exception as e:
                print(f"[anagram] can't load the {lang} dictionary: {type(e).__name__}: {e}")
                _DICTS[key] = None
        if _DICTS[key] and _DICTS[key].pool:
            out[lang] = _DICTS[key]
    return out


def marks(word, of):
    """Each letter of `word` against the round's word `of`: ok / extra (that letter is used up) / miss (no such letter)."""
    left = Counter(of)
    out = []
    for c in word:
        if c not in left:
            out.append("miss")
        elif left[c] > 0:
            left[c] -= 1
            out.append("ok")
        else:
            out.append("extra")
    return out


class _Played:
    """What SessionStats.round_finished needs of a round's player (no ranks here)."""

    def __init__(self, p):
        self.id, self.name, self.avatar, self.best = p["id"], p["name"], p["avatar"], 0


class AnagramStats(SessionStats):
    FILE = "anagram/players.json"


class AnagramGame(BaseGame):
    name = "anagram"
    title = "Anagram"
    OPTIONS = {"pause": [0, 10, 30, 60, 120],      # break between rounds, seconds (incl. the winner card)
               "round_min": [3, 5, 10, 15, 20, 30],  # round length, minutes
               "follow": [2, 1, 0],                # who plays: the host's team only / followers only / all
               "fan_min": [1, 5, 10, 15, 20, 25, 30, 40],
               "chroma": [0, 1], "chroma_top": [25, 30, 32, 33, 35, 40, 45, 50],
               "frame": [16, 19.5, 20], "chat_zone": [0, 10, 15, 20, 25, 30, 35]}
    SCREEN = GuessGame.SCREEN                      # tops, the bot's name, what the gifts do: the same "On screen" tab
    OPTIONS.update({k: choices for k, (_, choices) in SCREEN.items()})
    STATE = "anagram/state.json"
    USED = "anagram/used_words.json"
    ROUNDS = "anagram/rounds.json"

    def __init__(self, store):
        super().__init__(store)
        self.dicts = load_dicts(config.ASSETS_DIR)
        self.error = None if self.dicts else f"anagram: no dictionary with long words in {config.ASSETS_DIR}"
        if self.error:
            print("[anagram]", self.error)
        self.lang = config.LANGUAGE if config.LANGUAGE in self.dicts else ("ru" if "ru" in self.dicts else next(iter(self.dicts), "ru"))
        self.round_lang = self.lang
        self.pause_sec = config.WINNER_SEC + config.REVEAL_SEC
        self.round_sec = 10 * 60
        self.follow_required, self.fans_only, self.fan_min = False, False, 1
        self.chroma, self.chroma_top, self.chat_zone, self.frame = False, 33, 20, 16
        self.screen = {k: d for k, (d, _) in self.SCREEN.items()}
        self.stats = AnagramStats(store)
        self.used = {k: set(v) for k, v in (store.load(self.USED, {}) or {}).items()}
        self.history = store.load(self.ROUNDS, []) or []
        self.round_id = 0
        self.paused_at = None
        self.note_t = 0.0                            # last rejected answer shown
        self.follow_note_t = {}                      # viewer id -> last "follow to play"
        self._clear_round()
        self.phase = IDLE
        self.load()

    # ------------------------------------------------------------------ round
    def _clear_round(self):
        self.word = None
        self.possible = set()                        # every dictionary word the round's letters make
        self.started_at = self.ends_at = self.phase_until = self.finished_at = 0.0
        self.found = {}                              # word -> {word, id, name, avatar, n, t, last, last_avatar, last_t}
        self.players = {}                            # id -> {id, name, avatar, score, t, words}
        self.winner = None
        self.podium = []
        self.log = []

    @property
    def dict(self):
        return self.dicts.get(self.round_lang) or self.dicts.get(self.lang)

    def emit(self, type, **data):
        super().emit(type, **data)
        if type in LOG_EVENTS:
            self.log = (self.log + [dict({k: data[k] for k in ("name", "uid", "gift", "count", "word") if data.get(k) is not None},
                                         type=type, t=time.time())])[-80:]

    def _pick_word(self):
        """A long word not played yet in this language; when all of them were played, a new cycle starts."""
        used = self.used.setdefault(self.round_lang, set())
        fresh = [w for w in self.dict.pool if w not in used]
        if not fresh:
            print(f"[anagram] every long {self.round_lang} word was played: a new cycle")
            used.clear()
            fresh = list(self.dict.pool)
        word = random.choice(fresh)
        used.add(word)
        self.store.save(self.USED, {k: sorted(v) for k, v in self.used.items()})
        return word

    def _start_countdown(self, now):
        self._clear_round()
        self.round_id += 1
        self.round_lang = self.lang if self.lang in self.dicts else next(iter(self.dicts))
        self.word = self._pick_word()
        self.possible = set(self.dict.subwords(self.word))
        self.phase = COUNTDOWN
        self.phase_until = now + config.COUNTDOWN_SEC
        self.emit("countdown", round=self.round_id)
        print(f"[anagram] round {self.round_id} ({self.round_lang}), word has {len(self.word)} letters, "
              f"{len(self.possible)} words to find")

    def _start_playing(self, now):
        self.phase = PLAYING
        self.started_at, self.ends_at = now, now + self.round_sec
        self.emit("round_start", round=self.round_id, duration=self.round_sec, word=self.word.upper())
        if self.live:
            self.live.write("round_start", game=self.name, round=self.round_id, word=self.word, lang=self.round_lang,
                            duration=self.round_sec)

    def _ranked(self):
        return sorted(self.players.values(), key=lambda p: (-p["score"], p["t"]))

    def _finish(self, now, reason="timeout"):
        if self.phase != PLAYING:
            return
        self.phase = WINNER
        self.finished_at = now
        self.phase_until = now + config.WINNER_SEC
        ranked = self._ranked()
        top = ranked[0] if ranked and ranked[0]["score"] > 0 else None
        self.podium = [{"id": p["id"], "name": p["name"], "avatar": p["avatar"], "score": p["score"]} for p in ranked[:3]]
        streak = self.stats.round_finished([_Played(p) for p in ranked], top["id"] if top else None,
                                           [p["id"] for p in self.podium])
        self.stats.save()
        longest = max(self.found.values(), key=lambda f: (len(f["word"]), -f["t"]), default=None)
        if top:
            self.winner = {"id": top["id"], "name": top["name"], "avatar": top["avatar"], "score": top["score"],
                           "words": len(top["words"]), "streak": streak}
            self.emit("winner", word=self.word.upper(), name=top["name"], uid=top["id"], avatar=top["avatar"],
                      score=top["score"], streak=streak)
            if streak >= 2:
                self.emit("streak", name=top["name"], n=streak)
        else:
            self.emit("timeout", reason=reason, word=self.word.upper())
        self.history = (self.history + [{
            "round": self.round_id, "word": self.word, "reason": reason, "winner": top["name"] if top else None,
            "score": top["score"] if top else 0, "players": len(self.players), "found": len(self.found),
            "possible": len(self.possible), "podium": [p["name"] for p in self.podium],
            "longest": [longest["word"], longest["name"]] if longest else None, "at": int(now)}])[-300:]
        self.store.save(self.ROUNDS, self.history)
        if self.live:
            who = self.live.user(top["id"], top["name"]) if top else None
            if who:
                self.live.write("winner", game=self.name, round=self.round_id, user=who, word=self.word,
                                score=top["score"], seconds=round(now - self.started_at, 1), streak=streak)
            self.live.write("round_end", game=self.name, round=self.round_id, word=self.word, reason=reason,
                            winner=who, players=len(self.players), found=len(self.found), possible=len(self.possible),
                            podium=[dict(self.live.user(p["id"], p["name"]), score=p["score"]) for p in self.podium])
        print(f"[anagram] round {self.round_id} {reason}: word={self.word} "
              f"winner={top['name'] if top else '-'} score={top['score'] if top else 0}")

    # ------------------------------------------------------------------ answers
    def _note(self, now, **data):
        """A rejected answer on the overlay's line (not more often than NOTE_SEC: the chat is fast)."""
        if now - self.note_t < NOTE_SEC:
            return
        self.note_t = now
        self.emit("try", **data)

    def _may_play(self, viewer, now):
        if viewer.id.lower() == getattr(self, "host_id", config.TIKTOK_USERNAME.lower()):
            return True
        if self.fans_only and viewer.fan < self.fan_min:
            if now - self.follow_note_t.get(viewer.id, 0) > FOLLOW_NOTE_SEC:
                self.follow_note_t[viewer.id] = now
                self.emit("fans_only", name=viewer.name, n=self.fan_min)
            return False
        if self.follow_required and viewer.follows == 0:
            if now - self.follow_note_t.get(viewer.id, 0) > FOLLOW_NOTE_SEC:
                self.follow_note_t[viewer.id] = now
                self.emit("follow_needed", name=viewer.name, avatar=viewer.avatar, dq=True)
            return False
        return True

    def on_comment(self, viewer: Viewer, text: str, ts=None):
        if self.phase != PLAYING or not self.word:
            return
        d = self.dict
        word = normalize(text).strip(" !.?,")
        if not d or len(word) < MIN_LEN or not d.letter_re.fullmatch(word):
            return                                       # ordinary chat: not one word of this language
        if ts and ts < self.started_at - 3:              # typed before the round, delivered late
            return
        now = time.time()
        if not self._may_play(viewer, now):
            return
        who = dict(name=viewer.name, avatar=viewer.avatar, uid=viewer.id)
        m = marks(word, self.word)
        if any(x != "ok" for x in m):
            self._note(now, kind="bad", word=word.upper(), marks=m, **who)
            return
        if word not in d.words:
            self._note(now, kind="dict", word=word.upper(), **who)
            return
        f = self.found.get(word)
        if f and f["id"] == viewer.id:                   # their own word again: counts nothing
            self._note(now, kind="own", word=word.upper(), **who)
            return
        if f:
            if viewer.id in f["ids"]:                    # named it before: once per viewer
                return
            f["ids"].append(viewer.id)
            f["n"] += 1
            f["last"], f["last_avatar"], f["last_t"] = viewer.name, viewer.avatar, now
            owner = self.players.get(f["id"])
            if owner:
                owner["score"] += len(word)
                owner["t"] = now
            self.emit("try", kind="rep", word=word.upper(), points=len(word), n=f["n"], by=f["name"], byId=f["id"], **who)
            print(f"[anagram] {viewer.name}: {word} again -> {f['name']} x{f['n']}")
        else:
            p = self.players.get(viewer.id)
            if p is None:
                p = self.players[viewer.id] = {"id": viewer.id, "name": viewer.name, "avatar": viewer.avatar,
                                               "score": 0, "t": now, "words": []}
            p["name"], p["avatar"] = viewer.name, viewer.avatar or p["avatar"]
            p["words"].append(word)
            p["score"] += len(word)
            p["t"] = now
            self.found[word] = {"word": word, "id": viewer.id, "name": viewer.name, "avatar": viewer.avatar,
                                "n": 1, "t": now, "ids": [viewer.id], "last": "", "last_avatar": "", "last_t": 0.0}
            self.emit("try", kind="ok", word=word.upper(), points=len(word), **who)
            print(f"[anagram] {viewer.name}: {word} +{len(word)}")
        self.stats.get(viewer.id, viewer.name, viewer.avatar)["guesses"] += 1
        self.dirty = True

    def on_gift(self, viewer: Viewer, gift: str, count: int, repeat=False, actions=None):
        """The animations of a gift are the hub's; the game only thanks."""
        if not repeat:
            self.emit("gift", name=viewer.name, uid=viewer.id, avatar=viewer.avatar, gift=gift, count=count)

    def on_follow(self, viewer: Viewer):
        self.stats.follows += 1
        self.follow_note_t.pop(viewer.id, None)
        self.emit("follow", name=viewer.name, avatar=viewer.avatar)

    def manual_action(self, viewer, action):
        return False                                     # no game actions of its own: hints, boosts... are Guess the Word's

    # ------------------------------------------------------------------ lifecycle
    def on_activate(self):
        if self.paused_at:                               # resume timers where they stopped
            shift = time.time() - self.paused_at
            self.started_at += shift
            self.ends_at += shift
            self.phase_until += shift
            self.finished_at += shift
            self.paused_at = None
        self.dirty = True

    def on_deactivate(self):
        self.paused_at = time.time()

    def new_session(self):
        self.stats.reset()
        self.stats.save()
        self.round_id = 0
        self._clear_round()
        self.phase = IDLE
        self.paused_at = None
        self.dirty = True

    def set_option(self, key, value):
        if key == "pause":
            self.pause_sec = max(0, int(value))
            if self.phase == REVEAL:
                self.phase_until = self.finished_at + self.pause_sec
        elif key == "round_min":
            self.round_sec = max(60, int(value) * 60)    # from the next round
        elif key == "follow":
            self.fans_only = int(value) == 2
            self.follow_required = int(value) >= 1
        elif key == "fan_min":
            self.fan_min = int(value)
        elif key == "chroma":
            self.chroma = bool(value)
        elif key == "chroma_top" and int(value) in self.OPTIONS["chroma_top"]:
            self.chroma_top = int(value)
        elif key == "frame" and float(value) in self.OPTIONS["frame"]:
            self.frame = float(value) if float(value) % 1 else int(value)
        elif key == "chat_zone" and int(value) in self.OPTIONS["chat_zone"]:
            self.chat_zone = int(value)
        elif key in self.SCREEN and value in self.SCREEN[key][1]:
            self.screen[key] = value
        self.dirty = True

    def get_options(self):
        return {"pause": self.pause_sec, "round_min": self.round_sec // 60,
                "follow": 2 if self.fans_only else int(self.follow_required), "fan_min": self.fan_min,
                "chroma": int(self.chroma), "chroma_top": self.chroma_top, "frame": self.frame,
                "chat_zone": self.chat_zone, **self.screen}

    def set_lang(self, lang):
        """Another language: from the next round (the word on screen stays)."""
        if lang in self.dicts and lang != self.lang:
            self.lang = lang
            self.dirty = True

    @property
    def reveal_sec(self):
        return max(0, self.pause_sec - config.WINNER_SEC)

    def tick(self, now):
        if self.paused_at or not self.dicts:
            return
        if self.phase in (IDLE, FINISHED):
            self._start_countdown(now)
        elif self.phase == COUNTDOWN and now >= self.phase_until:
            self._start_playing(now)
        elif self.phase == PLAYING and now >= self.ends_at:
            self._finish(now)
        elif self.phase == WINNER and now >= self.phase_until:
            if not self.reveal_sec:
                self.phase = FINISHED
            else:
                self.phase = REVEAL
                self.phase_until = now + self.reveal_sec
                self.emit("reveal", word=self.word.upper())
            self.dirty = True
        elif self.phase == REVEAL and now >= self.phase_until:
            self.phase = FINISHED
            self.dirty = True

    # ------------------------------------------------------------------ simulation / debug
    def simulate_step(self):
        if self.phase != PLAYING:
            return 0.5
        name = random.choice(SIM_NAMES)
        v = Viewer(name.lower(), name, "", 1)
        roll = random.random()
        if roll < 0.15:                                  # a word with a letter the round's word lacks
            self.on_comment(v, random.choice(["яблоко", "жираф", "щука", "трасса"]))
        elif roll < 0.3 and self.found:                  # someone else's word again
            self.on_comment(v, random.choice(list(self.found)))
        elif self.possible:
            self.on_comment(v, random.choice(sorted(self.possible)))
        return random.uniform(0.4, 1.5)

    def debug(self, action, params):
        now = time.time()
        name = (params.get("name") or "Tester")[:30]
        if action == "start_round":
            if self.phase == PLAYING:
                self._finish(now, "skip")
            else:
                self._start_countdown(now)
        elif action == "finish_round":
            self._finish(now)
        elif action == "send_guess":
            self.on_comment(Viewer(name.lower(), name, "", 1), params.get("word", ""))
        elif action == "secret":
            return {"word": self.word, "phase": self.phase, "possible": len(self.possible)}
        elif action == "reset":
            self.new_session()
        else:
            return super().debug(action, params)
        return {"ok": True}

    # ------------------------------------------------------------------ public state
    def _player_row(self, p):
        return {"id": p["id"], "name": p["name"], "avatar": p["avatar"], "score": p["score"],
                "words": [{"w": w.upper(), "n": self.found[w]["n"] if w in self.found else 1,
                           "last": self.found[w]["last"] if w in self.found else "",
                           "lastT": self.found[w]["last_t"] if w in self.found else 0} for w in p["words"]]}

    def _last_round(self):
        r = self.history[-1] if self.history else None
        return {"word": r["word"], "winner": r.get("winner"), "score": r.get("score"), "podium": r.get("podium", [])} if r else None

    def snapshot(self):
        now = time.time()
        shown = self.phase in (PLAYING, WINNER, REVEAL, FINISHED)
        longest = max(self.found.values(), key=lambda f: (len(f["word"]), -f["t"]), default=None)
        return {
            "error": self.error,
            "phase": self.phase, "roundId": self.round_id,
            "startedAt": self.started_at, "endsAt": self.ends_at, "phaseUntil": self.phase_until, "now": now,
            "paused": bool(self.paused_at), "hostPaused": False,
            "word": self.word.upper() if self.word and shown else None,
            "letters": len(self.word) if self.word else 0,
            "players": [self._player_row(p) for p in self._ranked()[:40]],
            "stats": {"players": len(self.players), "found": len(self.found), "possible": len(self.possible)},
            "longest": {"word": longest["word"].upper(), "name": longest["name"], "avatar": longest["avatar"]} if longest else None,
            "winner": self.winner if self.phase in (WINNER, REVEAL) else None,
            "podium": self.podium if self.phase in (WINNER, REVEAL) else [],
            "streamLeaderboard": self.stats.leaderboard(),
            "champions": self.stats.champions(),
            "streak": self.stats.top_streak(),
            "lastRound": self._last_round(),
            "chroma": self.chroma_top if self.chroma else 0, "chromaTop": self.chroma_top,
            "frame": self.frame, "chatZone": self.chat_zone, "screen": self.screen,
            "breakSec": self.reveal_sec, "resultsSec": min(config.RESULTS_SEC, self.reveal_sec),
            "promo": config.PROMO_LINES_BY_LANG.get(self.lang, config.PROMO_LINES),
            "lang": self.round_lang, "languages": sorted(self.dicts),
        }

    # ------------------------------------------------------------------ persistence
    def save(self):
        self.stats.save()
        self.store.save(self.STATE, {
            "phase": self.phase, "round_id": self.round_id, "word": self.word, "lang": self.round_lang,
            "started_at": self.started_at, "ends_at": self.ends_at, "phase_until": self.phase_until,
            "finished_at": self.finished_at, "found": self.found, "players": self.players,
            "winner": self.winner, "podium": self.podium, "saved_at": self.paused_at or time.time(),
        })

    def load(self):
        d = self.store.load(self.STATE)
        if not d or not self.dicts:
            return
        try:
            self.round_id = d.get("round_id", 0)
            if d.get("lang") in self.dicts:
                self.round_lang = d["lang"]
            if not d.get("word") or d.get("phase") in (IDLE, None):
                return
            self.word = d["word"]
            self.possible = set(self.dict.subwords(self.word))
            self.phase = d["phase"]
            self.started_at, self.ends_at = d["started_at"], d["ends_at"]
            self.phase_until, self.finished_at = d["phase_until"], d.get("finished_at", 0.0)
            self.found, self.players = d.get("found", {}), d.get("players", {})
            self.winner, self.podium = d.get("winner"), d.get("podium", [])
            self.paused_at = d.get("saved_at")           # timers resume on activation
            print(f"[anagram] restored round {self.round_id} ({self.phase})")
        except Exception as e:
            print(f"[anagram] can't restore state ({e}), starting fresh")
            self._clear_round()
            self.phase = IDLE
