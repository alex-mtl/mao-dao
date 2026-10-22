"""The host's reports about the game: /round (раунд) - the current round, /history [N] (история [N]) - the
last N finished rounds. The bot can't reach the game, so it leaves a request; the game picks it up on its next
poll (every ~10 s while live) and answers with the data; the bot formats it and sends it to the host."""

import secrets
import time
from html import escape as e

from . import store, tg
from .words import norm

ROUND_COMMANDS = ("раунд", "round")          # "/round" in the host's menu
HISTORY_COMMANDS = ("история", "history")    # "/history 3" in the host's menu
REQ_TTL = 60                                 # a request the game didn't pick up in a minute is dropped
LIVE_SEC = 60                                # the game polled within this many seconds = it's on air
MAX_HISTORY = 10
TOP = 20

TEXT = {
    "not_host": "Эта команда только для ведущего.",
    "offline": "🔌 Игра сейчас не на связи — видимо, эфир не идёт. Запустите игру и эфир и повторите.",
    "asking": "⏳ Спрашиваю игру — ответ придёт через несколько секунд.",
    "round": "🎯 <b>Раунд {round}</b> — слово <b>{word}</b>{setter}\n⏱ {time} · 👥 {players} · ✍️ {guesses} догадок",
    "round_idle": "☕ Раунд {round} ещё не начался (перерыв или отсчёт).",
    "setter": ", загадал(а) <b>{name}</b>",
    "who": "\n<b>Участники</b> (лучшее место · догадок):",
    "who_row": "{i}. {name} — {best} · {n}",
    "top": "\n<b>Топ-{n} догадок</b>:",
    "top_row": "{i}. <b>{w}</b> #{r} — {name}",
    "none": "пока нет",
    "history_none": "📜 Сыгранных раундов пока нет.",
    "hist": "📜 <b>Раунд {round}</b> — слово <b>{word}</b>{setter}\n{result} · 👥 {players} · ✍️ {guesses} · ⏱ {time}",
    "won": "🏆 <b>{name}</b>",
    "won_words": "\n<b>Слова победителя</b>: {words}",
    "nobody": "⏰ никто не угадал",
    "no_top": "\n(топ догадок для этого раунда не сохранён — раунд сыгран до обновления)",
}


def first_word(text):
    return (norm(text).split(" ", 1) or [""])[0]


def is_round_command(text):
    return first_word(text) in ROUND_COMMANDS


def is_history_command(text):
    return first_word(text) in HISTORY_COMMANDS


def _live(gid, now):
    seen = (store.get("INST#" + gid) or {}).get("seen", {})
    return any(now - float(v.get("at", 0)) < LIVE_SEC for v in seen.values())   # {instance: {first, at}}


def request(chat, tg_id, text, now=None):
    """the host's /round or /history N: leave a request for the game"""
    now = now or time.time()
    game = (store.get("HOSTOF#" + tg_id) or {}).get("game")
    if not game:
        return [(chat, TEXT["not_host"])]
    if not _live(game, now):
        return [(chat, TEXT["offline"])]
    kind = "round" if is_round_command(text) else "history"
    arg = (norm(text).split(" ", 1) + [""])[1].strip()
    n = max(1, min(int(arg), MAX_HISTORY)) if arg.isdigit() else 1
    req = store.get("REQ#" + game) or {"items": []}
    items = [i for i in req["items"] if now - i["at"] < REQ_TTL][-4:]
    items.append({"id": secrets.token_hex(4), "type": kind, "n": n, "chat": chat, "at": now})
    store.put("REQ#" + game, {"items": items}, ttl=now + REQ_TTL)
    tg.send_temp(chat, TEXT["asking"], 15)
    return []


def pending(gid, now=None):
    """requests for the game's poll answer: [{id, type, n}]; they stay until answered or expired"""
    now = now or time.time()
    req = store.get("REQ#" + gid)
    if not req:
        return []
    return [{"id": i["id"], "type": i["type"], "n": i["n"]} for i in req["items"] if now - i["at"] < REQ_TTL]


def answer(gid, answers):
    """the game's answers: format and send each to the host who asked; drop the answered requests"""
    if not answers:
        return
    req = store.get("REQ#" + gid) or {"items": []}
    by_id = {i["id"]: i for i in req["items"]}
    for a in answers:
        q = by_id.pop(a.get("id"), None)
        if not q:
            continue
        for text in (format_round(a.get("data") or {}) if a.get("type") == "round"
                     else format_history(a.get("data") or [])):
            tg.send(q["chat"], text)
    if by_id:
        store.put("REQ#" + gid, {"items": list(by_id.values())}, ttl=time.time() + REQ_TTL)
    else:
        store.delete("REQ#" + gid)


def _time(sec):
    sec = int(sec or 0)
    return f"{sec // 60}:{sec % 60:02d}"


def _top(rows):
    if not rows:
        return [TEXT["top"].format(n=TOP), TEXT["none"]]
    return [TEXT["top"].format(n=min(TOP, len(rows)))] + \
           [TEXT["top_row"].format(i=i + 1, w=e(str(w)), r=r, name=e(str(name or ""))) for i, (w, r, name) in enumerate(rows[:TOP])]


def format_round(d):
    if d.get("phase") not in ("playing", "winner") or not d.get("word"):
        return [TEXT["round_idle"].format(round=d.get("round") or "")]
    lines = [TEXT["round"].format(round=d.get("round"), word=e(d["word"]),
                                  setter=TEXT["setter"].format(name=e(d["setter"])) if d.get("setter") else "",
                                  time=_time(d.get("seconds")), players=d.get("players", 0), guesses=d.get("guesses", 0))]
    who = d.get("who") or []
    lines.append(TEXT["who"])
    lines += [TEXT["who_row"].format(i=i + 1, name=e(str(name)), best=f"#{best}" if best else "—", n=n)
              for i, (name, best, n) in enumerate(who[:TOP])] or [TEXT["none"]]
    lines += _top(d.get("top") or [])
    return ["\n".join(lines)]


def format_history(rounds):
    if not rounds:
        return [TEXT["history_none"]]
    out = []
    for d in rounds:                                     # one message per round (newest first)
        lines = [TEXT["hist"].format(round=d.get("round"), word=e((d.get("word") or "").upper()),
                                     setter=TEXT["setter"].format(name=e(d["setter"])) if d.get("setter") else "",
                                     result=TEXT["won"].format(name=e(d["winner"])) if d.get("winner") else TEXT["nobody"],
                                     players=d.get("players", 0), guesses=d.get("guesses", 0), time=_time(d.get("seconds")))]
        if d.get("winner_words"):
            lines.append(TEXT["won_words"].format(words=", ".join(f"{e(w)} #{r}" for w, r in d["winner_words"])))
        if d.get("top") is None:
            lines.append(TEXT["no_top"])
        else:
            lines += _top(d["top"])
        out.append("\n".join(lines))
    return out
