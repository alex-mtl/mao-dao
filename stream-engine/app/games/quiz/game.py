"""Quiz: a round = QCOUNT questions of one quiz of the platform. At the round's start a topic is picked at random
(among the streamer's topics, or the next one they queued), then a quiz of that topic and its questions not played
on this stream yet. A question shows on screen without its answers; viewers type answers in the chat. Every
answer that is one of the question's variants (the right one or one of its up to 14 wrong ones, bank.py) becomes
a row of the table: the variant, and who stands for it now - the first to name it on top of the others. Anything
else flashes on the answer line and is gone. Only a viewer's LAST variant counts (they may change their mind).

When the question's time is up the answer shows, and everyone whose last variant is the right one scores:
1 point, 0.9 when their first variant of this question was a wrong one; the first to name the right answer
(among those) 1.2 (1.1 when they had said a wrong one before). The round's winner has the most points after
the last question (a tie: each of them wins the round); stream champions = most rounds won (like Guess the Word).

Round state machine (everything on one asyncio loop, like the other games):
    IDLE -> TOPIC -> (INTRO -> ASK -> ANSWER) x QCOUNT -> WINNER -> REVEAL -> FINISHED -> TOPIC ...
"""

import random
import re
import time

from ... import config
from ..base import BaseGame, Viewer
from ..guess.game import GuessGame
from ..guess.players import SessionStats
from .bank import LEVELS, TOPICS, bank

IDLE, TOPIC, INTRO, ASK, ANSWER, WINNER, REVEAL, FINISHED = (
    "idle", "topic", "intro", "ask", "answer", "winner", "reveal", "finished")

TOPIC_SEC = 4.5               # the topic roulette at the round's start
INTRO_SEC = 2                 # "QUESTION 2 / 5"
NOTE_SEC = 0.6                # chat that is no variant flashes on the answer line at most this often
FOLLOW_NOTE_SEC = 30
MAX_CHAT = 40                 # a longer message is ordinary chat, not an answer
STACK = 7                     # a row shows this many of its players, then "+N"
PTS_RIGHT, PTS_CHANGED, PTS_FIRST = 1.0, 0.9, 1.2
# the answer options' letters (typed doubled: "аа", "ББ"); Russian rooms get Cyrillic ones
LETTERS = {"ru": "АБВГДЕЖЗ", "en": "ABCDEFGH", "fr": "ABCDEFGH", "es": "ABCDEFGH"}
# what a viewer may type instead on another keyboard: Latin look-alikes of the Cyrillic letters, "33" for ЗЗ
LOOKALIKE = {"А": ["A"], "В": ["B"], "Е": ["E"], "З": ["3"]}
LOG_EVENTS = {"topic", "round_start", "question", "answer", "winner", "timeout", "gift"}
SIM_NAMES = ["Alex", "Mike", "Sarah", "Нина", "Krestik", "фог", "Tati", "Valeria", "Сергей", "Maksim", "Лена", "Dima"]


def norm(text):
    """the same variant however it is typed: case, ё, spaces, hyphens, punctuation"""
    return re.sub(r"[^\w]+|_", "", (text or "").lower().replace("ё", "е"))


class Topics(list):
    """The topics option: any comma-separated set of TOPICS (the hub checks a value with `in`)."""

    def __contains__(self, value):
        if not isinstance(value, str):
            return False
        parts = [p for p in value.split(",") if p]
        return bool(parts) and all(p in TOPICS for p in parts)


class QuizStats(SessionStats):
    FILE = "quiz/players.json"


class _Played:
    def __init__(self, p):
        self.id, self.name, self.avatar, self.best = p["id"], p["name"], p["avatar"], 0


class QuizGame(BaseGame):
    name = "quiz"
    title = "Quiz"
    OPTIONS = {"qtime": [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],   # seconds per question
               "qcount": [3, 5, 7, 10],                                       # questions per round
               "answer_sec": [4, 6, 8, 10, 15],                               # the answer on screen
               "pause": [0, 10, 30, 60, 120, 180, 300],                       # break between rounds (incl. the winner card)
               "level": ["all", "easy", "medium", "hard"],
               "topics": Topics(TOPICS),
               "order": ["votes", "time"],                                    # the table: most players first / as named
               "hints": [0, 4, 6, 8],                                             # the game puts N variants (the right one among them) in the table
               "follow": [2, 1, 0], "fan_min": [1, 5, 10, 15, 20, 25, 30, 40],
               "chroma": [0, 1], "chroma_top": [25, 30, 32, 33, 35, 40, 45, 50],
               "frame": [16, 19.5, 20], "chat_zone": [0, 10, 15, 20, 25, 30, 35]}
    SCREEN = GuessGame.SCREEN                      # tops, the bot's name, what the gifts do: the same "On screen" tab
    OPTIONS.update({k: choices for k, (_, choices) in SCREEN.items()})
    STATE = "quiz/state.json"
    USED = "quiz/used.json"
    ROUNDS = "quiz/rounds.json"

    def __init__(self, store):
        super().__init__(store)
        self.lang = config.LANGUAGE
        self.qtime, self.qcount, self.answer_sec, self.pause_sec = 30, 5, 6, 60
        self.level, self.topics, self.order, self.hints = "all", list(TOPICS), "votes", 0
        self.follow_required, self.fans_only, self.fan_min = False, False, 1
        self.chroma, self.chroma_top, self.chat_zone, self.frame = False, 33, 20, 16
        self.screen = {k: d for k, (d, _) in self.SCREEN.items()}
        self.stats = QuizStats(store)
        self.used = set(store.load(self.USED, []) or [])        # question ids played (a new cycle when a topic runs out)
        self.history = store.load(self.ROUNDS, []) or []
        self.queue = []                                         # topics the host queued for the next rounds
        self.round_id = 0
        self.paused_at = self.frozen_at = None
        self.session_at = 0
        self.note_t = 0.0
        self.follow_note_t = {}
        self.error = None
        self._clear_round()
        self.phase = IDLE
        self.load()

    # ------------------------------------------------------------------ round
    def _clear_round(self):
        self.topic = self.quiz = None
        self.questions = []                       # [{id, text, correct, wrong}]
        self.qi = -1
        self.players = {}                         # id -> {id, name, avatar, score, t, right}
        self.qlog = []                            # the round's questions: what happened
        self.winner, self.winners, self.podium = None, [], []
        self.started_at = self.phase_until = self.ends_at = self.finished_at = 0.0
        self.finish_reason = "done"
        self.rest = []                            # the quiz's other questions: spares for "skip"
        self.log = []
        self._clear_question()

    def _clear_question(self):
        self.accept = {}                          # norm -> the variant as shown
        self.answers = {}                         # viewer id -> [[norm, t], ...] their variants in order
        self.who = {}                             # viewer id -> {name, avatar}
        self.variants = {}                        # norm -> {w, author, t}, in the order named
        self.scorers = []
        self.asked_at = 0.0

    @property
    def question(self):
        return self.questions[self.qi] if 0 <= self.qi < len(self.questions) else None

    def emit(self, type, **data):
        super().emit(type, **data)
        if type in LOG_EVENTS:
            self.log = (self.log + [dict({k: data[k] for k in ("name", "uid", "gift", "count", "word", "n", "q", "topic", "title", "score")
                                                          if data.get(k) is not None}, type=type, t=time.time())])[-80:]

    def _pool(self, topic=None):
        """the quizzes the settings allow (of a topic)"""
        out = []
        for q in bank().quizzes(self.lang) or bank().quizzes("ru"):
            if topic and q["topic"] != topic:
                continue
            if not topic and q["topic"] not in self.topics:
                continue
            if self.level != "all" and q.get("level") and q["level"] != self.level:
                continue
            out.append(q)
        return out

    def _pick(self):
        """the round's topic (queued / at random), a quiz of it with questions not played yet, and its questions"""
        pool = self._pool()
        if not pool:                              # nothing of the chosen topics / level: any topic, any level
            pool = bank().quizzes(self.lang) or bank().quizzes("ru")
        if not pool:
            return False
        topics = sorted({q["topic"] for q in pool})
        topic = None
        while self.queue and not topic:
            t = self.queue.pop(0)
            if any(q["topic"] == t for q in bank().quizzes(self.lang) or bank().quizzes("ru")):
                topic = t
        quizzes = self._pool(topic) if topic else None
        if not quizzes:
            topic = random.choice(topics)
            quizzes = [q for q in pool if q["topic"] == topic]
        fresh = [q for q in quizzes if sum(1 for x in q["questions"] if x["id"] not in self.used) >= min(self.qcount, len(q["questions"]))]
        if not fresh:                             # the topic was played through: its questions start over
            ids = {x["id"] for q in quizzes for x in q["questions"]}
            self.used -= ids
            print(f"[quiz] every question of {topic} was played: a new cycle")
            fresh = quizzes
        quiz = random.choice(fresh)
        left = [x for x in quiz["questions"] if x["id"] not in self.used] or list(quiz["questions"])
        self.questions = random.sample(left, min(self.qcount, len(left)))
        self.used.update(x["id"] for x in self.questions)
        self.store.save(self.USED, sorted(self.used))
        self.topic, self.quiz = topic, {"id": quiz["id"], "title": quiz["title"], "level": quiz.get("level"), "key": quiz.get("key")}
        self.rest = [x for x in quiz["questions"] if x["id"] not in {y["id"] for y in self.questions}]   # spares for "skip"
        return True

    def _start_round(self, now):
        self._clear_round()
        if not self._pick():
            self.error = "quiz: no questions (the platform's quiz bank is empty)"
            return
        self.error = None
        self.round_id += 1
        self.phase = TOPIC
        self.started_at = now
        self.phase_until = now + TOPIC_SEC
        self.emit("topic", round=self.round_id, topic=self.topic, title=self.quiz["title"])
        print(f"[quiz] round {self.round_id}: {self.topic} - {self.quiz['title']} ({len(self.questions)} questions)")
        if self.live:
            self.live.write("round_start", game=self.name, round=self.round_id, topic=self.topic, quiz=self.quiz["title"],
                            questions=len(self.questions))

    def _intro(self, now):
        self.qi += 1
        self._clear_question()
        if self.qi >= len(self.questions):
            return self._close(now)
        self.phase = INTRO
        self.phase_until = now + INTRO_SEC
        self.emit("intro", n=self.qi + 1, of=len(self.questions))

    def _ask(self, now):
        q = self.question
        self.accept = {norm(q["correct"]): q["correct"]}
        for w in q["wrong"]:
            k = norm(w)
            if k and k not in self.accept:
                self.accept[k] = w
        self.phase = ASK
        self.asked_at = now
        self.ends_at = now + self.qtime
        if self.hints:
            # the game's own rows ("as if a player wrote them", author ""): the right answer and the quiz's own wrong
            # ones (the first of the pool), shuffled, each with its letter (АА, ББ, ВВ...). Only these are answers now:
            # the doubled letter (any case) or the word. Nobody stands for them and they score nothing - the first
            # viewer to name the right one still gets the most. The rows keep this order (no sorting by players).
            seeds = [q["correct"]] + [w for w in q["wrong"] if norm(w) != norm(q["correct"])][:self.hints - 1]
            random.shuffle(seeds)
            letters = LETTERS.get(self.lang, LETTERS["en"])
            self.accept = {}
            for i, w in enumerate(seeds):
                tag = letters[i]
                self.variants[norm(w)] = {"w": w, "author": "", "t": now + i * 0.001, "tag": tag * 2}
                self.accept[norm(w)] = w
            for i, w in enumerate(seeds):                # the letters after the words: a word wins a clash
                for c in [letters[i]] + LOOKALIKE.get(letters[i], []):
                    self.accept.setdefault(norm(c * 2), w)
                    self.accept.setdefault(norm(c * 2 + w), w)   # "АА Волга" as it stands on screen
        self.emit("round_start" if self.qi == 0 else "question", round=self.round_id, n=self.qi + 1, q=q["text"])

    def _last(self, pid):
        a = self.answers.get(pid)
        return a[-1][0] if a else None

    def supporters(self, k):
        """who stands for the variant now (their last answer), in the order they first named it"""
        def named(pid):
            return next(t for kk, t in self.answers[pid] if kk == k)
        return sorted((pid for pid in self.answers if self._last(pid) == k), key=named)

    def _reveal(self, now):
        """time is up: the answer, the points of the question"""
        q = self.question
        right = norm(q["correct"])
        rows = []
        for pid, lst in self.answers.items():
            if lst[-1][0] != right:
                continue
            first_right = next(t for k, t in lst if k == right)
            rows.append({"id": pid, "changed": lst[0][0] != right, "t": first_right})
        rows.sort(key=lambda r: r["t"])
        self.scorers = []
        for i, r in enumerate(rows):
            pts = round(PTS_FIRST - (0.1 if r["changed"] else 0), 1) if i == 0 else (PTS_CHANGED if r["changed"] else PTS_RIGHT)
            w = self.who[r["id"]]
            p = self.players.setdefault(r["id"], {"id": r["id"], "name": w["name"], "avatar": w["avatar"], "score": 0, "t": now, "right": 0})
            p["score"] = round(p["score"] + pts, 1)
            p["right"] += 1
            p["t"] = now
            self.scorers.append({"id": r["id"], "name": w["name"], "avatar": w["avatar"], "pts": pts, "first": i == 0})
        self.phase = ANSWER
        self.phase_until = now + self.answer_sec
        self.qlog.append({"q": q["text"], "a": q["correct"], "variants": len(self.variants), "answered": len(self.answers),
                          "right": len(self.scorers), "first": self.scorers[0]["name"] if self.scorers else None})
        self.emit("answer", word=q["correct"], n=len(self.scorers), of=len(self.answers),
                  name=self.scorers[0]["name"] if self.scorers else None, q=q["text"])
        print(f"[quiz] round {self.round_id} q{self.qi + 1}: {q['correct']} - {len(self.scorers)} of {len(self.answers)} right")

    def _ranked(self):
        return sorted(self.players.values(), key=lambda p: (-p["score"], p["t"]))

    def _close(self, now, reason="done"):
        self.phase = WINNER
        self.finished_at = now
        self.phase_until = now + config.WINNER_SEC
        self.finish_reason = reason
        ranked = self._ranked()
        best = ranked[0]["score"] if ranked and ranked[0]["score"] > 0 else 0
        self.winners = [p for p in ranked if best and p["score"] == best]
        top = self.winners[0] if self.winners else None
        self.podium = [{"id": p["id"], "name": p["name"], "avatar": p["avatar"], "score": p["score"]} for p in ranked[:3]]
        streak = self.stats.round_finished([_Played(p) for p in ranked], top["id"] if top else None,
                                           [p["id"] for p in self.podium])
        for p in self.winners[1:]:               # a tie: each of them wins the round
            s = self.stats.get(p["id"], p["name"], p["avatar"])
            s["wins"] += 1
            s["streak"] += 1
            s["best_streak"] = max(s["best_streak"], s["streak"])
        self.stats.save()
        if top:
            self.winner = {"id": top["id"], "name": top["name"], "avatar": top["avatar"], "score": top["score"],
                           "right": top["right"], "streak": streak, "tie": len(self.winners)}
            self.emit("winner", name=top["name"], uid=top["id"], avatar=top["avatar"], score=top["score"], streak=streak,
                      tie=[p["name"] for p in self.winners[1:]])
            if streak >= 2:
                self.emit("streak", name=top["name"], n=streak)
        else:
            self.emit("timeout", reason=reason)
        self.history = (self.history + [{
            "round": self.round_id, "topic": self.topic, "quiz": self.quiz["title"] if self.quiz else "",
            "reason": reason, "winner": ", ".join(p["name"] for p in self.winners) or None, "score": best,
            "players": len(self.players), "podium": [[p["name"], p["score"]] for p in self.podium],
            "questions": self.qlog, "at": int(now)}])[-300:]
        self.store.save(self.ROUNDS, self.history)
        if self.live:
            who = self.live.user(top["id"], top["name"]) if top else None
            if who:
                self.live.write("winner", game=self.name, round=self.round_id, user=who, score=top["score"],
                                seconds=round(now - self.started_at, 1), streak=streak)
            self.live.write("round_end", game=self.name, round=self.round_id, topic=self.topic, reason=reason, winner=who,
                            players=len(self.players), questions=len(self.qlog),
                            podium=[dict(self.live.user(p["id"], p["name"]), score=p["score"]) for p in self.podium])
        print(f"[quiz] round {self.round_id} {reason}: winner={self.winner['name'] if self.winner else '-'} score={best}")

    # ------------------------------------------------------------------ answers
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
        if self.phase != ASK or self.frozen_at:
            return
        text = (text or "").strip()
        k = norm(text)
        if not k or len(text) > MAX_CHAT:
            return
        if ts and ts < self.asked_at - 2:                # typed before the question, delivered late
            return
        now = time.time()
        if not self._may_play(viewer, now):
            return
        who = dict(name=viewer.name, avatar=viewer.avatar, uid=viewer.id)
        word = self.accept.get(k)
        if not word:
            if now - self.note_t >= NOTE_SEC:            # not a variant: flashes on the answer line
                self.note_t = now
                self.emit("try", kind="miss", word=text[:32], **who)
            return
        k = norm(word)                                   # "бб" (an option's letter) -> its word
        self.who[viewer.id] = {"name": viewer.name, "avatar": viewer.avatar}
        lst = self.answers.setdefault(viewer.id, [])
        if lst and lst[-1][0] == k:                      # the same answer again
            return
        lst.append([k, now])
        new = k not in self.variants
        if new:
            self.variants[k] = {"w": word, "author": viewer.id, "t": now}
        self.stats.get(viewer.id, viewer.name, viewer.avatar)["guesses"] += 1
        self.emit("try", kind="ok", word=word, tag=self.variants[k].get("tag"), new=new, changed=len(lst) > 1, **who)
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
        return False                                     # hints, boosts... are Guess the Word's

    def rename_viewer(self, old, new):
        for d in (self.answers, self.who, self.players):
            if old in d and new not in d:
                d[new] = d.pop(old)
                if isinstance(d[new], dict) and "id" in d[new]:
                    d[new]["id"] = new
        for v in self.variants.values():
            if v["author"] == old:
                v["author"] = new

    # ------------------------------------------------------------------ lifecycle
    def _shift(self, d):
        self.started_at += d
        self.ends_at += d
        self.phase_until += d
        self.finished_at += d
        self.asked_at += d

    def on_activate(self):
        if self.paused_at:
            shift = time.time() - self.paused_at
            self._shift(shift)
            if self.frozen_at:
                self.frozen_at += shift
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
        self.paused_at = self.frozen_at = None
        self.session_at = time.time()
        self.dirty = True

    def set_option(self, key, value):
        if key == "qtime":
            self.qtime = int(value)
        elif key == "qcount":
            self.qcount = int(value)                     # from the next round
        elif key == "answer_sec":
            self.answer_sec = int(value)
        elif key == "pause":
            self.pause_sec = max(0, int(value))
            if self.phase == REVEAL:
                self.phase_until = self.finished_at + self.pause_sec
        elif key == "level" and value in self.OPTIONS["level"]:
            self.level = value
        elif key == "topics" and value in self.OPTIONS["topics"]:
            self.topics = [t for t in TOPICS if t in value.split(",")]
        elif key == "hints" and value in self.OPTIONS["hints"]:
            self.hints = int(value)                      # from the next question
        elif key == "order" and value in self.OPTIONS["order"]:
            self.order = value
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
        return {"qtime": self.qtime, "qcount": self.qcount, "answer_sec": self.answer_sec, "pause": self.pause_sec,
                "level": self.level, "topics": ",".join(self.topics), "order": self.order, "hints": self.hints,
                "follow": 2 if self.fans_only else int(self.follow_required), "fan_min": self.fan_min,
                "chroma": int(self.chroma), "chroma_top": self.chroma_top, "frame": self.frame,
                "chat_zone": self.chat_zone, **self.screen}

    def set_lang(self, lang):
        if lang != self.lang:
            self.lang = lang                             # the next round's quiz
            self.dirty = True

    @property
    def reveal_sec(self):
        return max(0, self.pause_sec - config.WINNER_SEC)

    # ------------------------------------------------------------------ the host's controls (room page)
    def control(self, cmd, params):
        now = time.time()
        if cmd == "pause":
            if self.frozen_at:
                return False
            self.frozen_at = now
        elif cmd == "resume":
            if not self.frozen_at:
                return False
            shift, self.frozen_at = now - self.frozen_at, None
            self._shift(shift)
        elif cmd == "extend":                            # +N seconds to the question
            if self.phase != ASK:
                return False
            self.ends_at += max(5, min(int(params.get("sec") or 10), 120))
        elif cmd == "reveal":                            # the answer now
            if self.phase != ASK or self.frozen_at:
                return False
            self._reveal(now)
        elif cmd == "skip":                              # this question goes, another of the quiz instead, no points
            if self.phase not in (INTRO, ASK) or self.frozen_at:
                return False
            if self.rest:
                self.questions[self.qi] = self.rest.pop(random.randrange(len(self.rest)))
                self.used.add(self.questions[self.qi]["id"])
                self.qi -= 1
            self._intro(now)
        elif cmd == "finish":                            # the round ends now with the points so far
            if self.phase not in (TOPIC, INTRO, ASK, ANSWER) or self.frozen_at:
                return False
            if self.phase == ASK:
                self._reveal(now)
            self._close(now, "host")
        elif cmd == "queue_add":
            topic = str(params.get("topic") or "")
            if topic not in TOPICS or len(self.queue) >= 20:
                return {"ok": False, "error": "unknown topic"}
            self.queue.append(topic)
        elif cmd == "queue_del":
            try:
                self.queue.pop(int(params.get("i")))
            except (TypeError, ValueError, IndexError):
                return False
        elif cmd == "queue_move":
            try:
                i, j = int(params.get("i")), int(params.get("to"))
                self.queue.insert(j, self.queue.pop(i))
            except (TypeError, ValueError, IndexError):
                return False
        else:
            return False
        self.dirty = True
        return True

    def _stream_rounds(self):
        out = []
        for r in reversed(self.history):
            if r.get("at", 0) < self.session_at or (out and r["round"] >= out[-1]["round"]):
                break
            out.append(r)
        return out

    def _variant_rows(self, limit=STACK):
        """the table: [{w, n, players: [{name, avatar}] (the first ones), author, t, right}]"""
        rows = []
        for i, (k, v) in enumerate(self.variants.items()):
            sup = self.supporters(k)
            a = self.who.get(v["author"], {"name": v["author"], "avatar": ""})
            rows.append({"k": k, "w": v["w"], "n": len(sup), "i": i, "t": v["t"], "seed": not v["author"], "tag": v.get("tag"),
                         "players": [dict(self.who[p], id=p) for p in sup[:limit]],
                         "author": {"id": v["author"], "name": a["name"], "avatar": a["avatar"]}})
        if self.order == "votes" and not any(r["tag"] for r in rows):   # the lettered options keep their places
            rows.sort(key=lambda r: (-r["n"], r["i"]))
        return rows

    def monitor(self):
        now = time.time()
        at = self.frozen_at or now
        q = self.question
        right = norm(q["correct"]) if q else None
        return {
            "current": {
                "phase": self.phase, "round": self.round_id, "paused": bool(self.frozen_at),
                "topic": self.topic, "quiz": self.quiz, "n": self.qi + 1, "of": len(self.questions),
                "question": q["text"] if q else None, "answer": q["correct"] if q else None,
                "wrong": q["wrong"] if q else [], "variantsMax": len(self.accept),
                "left": max(0, round(self.ends_at - at)) if self.phase == ASK else 0,
                "phaseLeft": max(0, round(self.phase_until - at)), "qtime": self.qtime,
                "answered": len(self.answers),
                "variants": [{"w": (r["tag"] + " · " if r["tag"] else "") + r["w"], "n": r["n"], "author": r["author"]["name"] or "💡", "t": round(r["t"] - self.asked_at),
                              "right": r["k"] == right} for r in self._variant_rows(0)],
                "people": [{"id": p["id"], "name": p["name"], "avatar": p["avatar"], "score": p["score"], "right": p["right"],
                            "wins": self.stats.players.get(p["id"], {}).get("wins", 0)} for p in self._ranked()[:60]],
                "scorers": self.scorers,
                "log": list(reversed(self.log))[:40],
            },
            "past": self._stream_rounds()[:200],
            "plan": {"queue": list(self.queue), "topics": self.topics,
                     "available": sorted({x["topic"] for x in (bank().quizzes(self.lang) or bank().quizzes("ru"))})},
            "leaders": self.stats.leaderboard(10),
        }

    def tick(self, now):
        if self.paused_at or self.frozen_at:
            return
        if self.phase in (IDLE, FINISHED):
            self._start_round(now)
        elif self.phase == TOPIC and now >= self.phase_until:
            self._intro(now)
        elif self.phase == INTRO and now >= self.phase_until:
            self._ask(now)
        elif self.phase == ASK and now >= self.ends_at:
            self._reveal(now)
        elif self.phase == ANSWER and now >= self.phase_until:
            self._intro(now)
        elif self.phase == WINNER and now >= self.phase_until:
            if not self.reveal_sec:
                self.phase = FINISHED
            else:
                self.phase = REVEAL
                self.phase_until = now + self.reveal_sec
                self.emit("reveal")
            self.dirty = True
        elif self.phase == REVEAL and now >= self.phase_until:
            self.phase = FINISHED
            self.dirty = True

    # ------------------------------------------------------------------ simulation / debug
    def simulate_step(self):
        if self.phase != ASK or not self.question:
            return 0.5
        name = random.choice(SIM_NAMES)
        v = Viewer(name.lower(), name, "", 1)
        q = self.question
        roll = random.random()
        if roll < 0.15:
            self.on_comment(v, random.choice(["привет", "кто знает?", "лол", "не знаю"]))
        elif roll < 0.55:
            self.on_comment(v, q["correct"])
        else:
            self.on_comment(v, random.choice(q["wrong"][:5] or [q["correct"]]))
        return random.uniform(0.3, 1.2)

    def debug(self, action, params):
        now = time.time()
        name = (params.get("name") or "Tester")[:30]
        if action == "start_round":
            self._start_round(now)
        elif action == "finish_round":
            self.control("finish", {})
        elif action == "send_guess":
            self.on_comment(Viewer(name.lower(), name, "", 1), params.get("word", ""))
        elif action == "secret":
            q = self.question
            return {"answer": q["correct"] if q else None, "phase": self.phase}
        elif action == "reset":
            self.new_session()
        else:
            return super().debug(action, params)
        return {"ok": True}

    # ------------------------------------------------------------------ public state
    def _last_round(self):
        r = self.history[-1] if self.history else None
        return {"topic": r.get("topic"), "winner": r.get("winner"), "score": r.get("score")} if r else None

    def snapshot(self):
        now = time.time()
        q = self.question
        shown = self.phase in (ASK, ANSWER)
        rows = self._variant_rows() if shown else []
        right = norm(q["correct"]) if q else None
        return {
            "error": self.error,
            "phase": self.phase, "roundId": self.round_id, "n": self.qi + 1, "of": len(self.questions) or self.qcount,
            "startedAt": self.asked_at or self.started_at, "endsAt": self.ends_at, "phaseUntil": self.phase_until, "now": now,
            "paused": bool(self.paused_at), "hostPaused": bool(self.frozen_at),
            "pausedLeft": max(0, round(self.ends_at - self.frozen_at)) if self.frozen_at and self.phase == ASK else 0,
            "topic": self.topic, "quiz": self.quiz["title"] if self.quiz else None, "topics": self.topics,
            "question": q["text"] if q and self.phase in (ASK, ANSWER) else None,
            "answer": q["correct"] if q and self.phase == ANSWER else None,
            "variants": [{"w": r["w"], "n": r["n"], "players": r["players"], "author": r["author"], "seed": r["seed"], "tag": r["tag"],
                          "right": self.phase == ANSWER and r["k"] == right} for r in rows],
            "scorers": self.scorers if self.phase == ANSWER else [],
            "players": [{"id": p["id"], "name": p["name"], "avatar": p["avatar"], "score": p["score"]} for p in self._ranked()[:20]],
            "stats": {"players": len(self.answers) if shown else len(self.players)},
            "winner": self.winner if self.phase in (WINNER, REVEAL) else None,
            "winners": [{"name": p["name"], "avatar": p["avatar"]} for p in self.winners] if self.phase in (WINNER, REVEAL) else [],
            "podium": self.podium if self.phase in (WINNER, REVEAL) else [],
            "streamLeaderboard": self.stats.leaderboard(),
            "champions": self.stats.champions(),
            "streak": self.stats.top_streak(),
            "lastRound": self._last_round(),
            "chroma": self.chroma_top if self.chroma else 0, "chromaTop": self.chroma_top,
            "frame": self.frame, "chatZone": self.chat_zone, "screen": self.screen,
            "qtime": self.qtime, "order": self.order, "stack": STACK,
            "breakSec": self.reveal_sec, "resultsSec": min(config.RESULTS_SEC, self.reveal_sec),
            "promo": config.PROMO_LINES_BY_LANG.get(self.lang, config.PROMO_LINES),
            "lang": self.lang,
        }

    # ------------------------------------------------------------------ persistence
    def save(self):
        self.stats.save()
        self.store.save(self.STATE, {
            "phase": self.phase, "round_id": self.round_id, "topic": self.topic, "quiz": self.quiz,
            "questions": self.questions, "rest": self.rest, "qi": self.qi,
            "players": self.players, "qlog": self.qlog, "answers": self.answers, "who": self.who,
            "variants": self.variants, "accept": self.accept, "scorers": self.scorers,
            "started_at": self.started_at, "asked_at": self.asked_at, "ends_at": self.ends_at,
            "phase_until": self.phase_until, "finished_at": self.finished_at, "winner": self.winner,
            "winners": self.winners, "podium": self.podium, "saved_at": self.paused_at or time.time(),
            "frozen_at": self.frozen_at, "session_at": self.session_at, "queue": self.queue,
        })

    def load(self):
        d = self.store.load(self.STATE)
        if not d:
            return
        try:
            self.round_id = d.get("round_id", 0)
            self.session_at = d.get("session_at", 0)
            self.queue = d.get("queue") or []
            if d.get("phase") in (IDLE, None) or not d.get("questions"):
                return
            for k in ("topic", "quiz", "questions", "rest", "qi", "players", "qlog", "answers", "who", "variants",
                      "accept", "scorers", "started_at", "asked_at", "ends_at", "phase_until", "finished_at",
                      "winner", "winners", "podium"):
                if k in d:
                    setattr(self, k, d[k])
            self.phase = d["phase"]
            self.paused_at = d.get("saved_at")           # timers resume on activation
            self.frozen_at = d.get("frozen_at")
            print(f"[quiz] restored round {self.round_id} ({self.phase})")
        except Exception as e:
            print(f"[quiz] can't restore state ({e}), starting fresh")
            self._clear_round()
            self.phase = IDLE
