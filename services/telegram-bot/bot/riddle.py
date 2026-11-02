"""Words viewers pick for the guess game. The host always decides: nothing goes into a round without ✅.

  a word comes two ways:
    viewer: "/zagadka" (menu) or "загадка" -> the bot asks for a word (only viewers linked to a game)
    host:   "загадывает [part of a nick]" or "/pick" -> buttons with the game's linked viewers -> the bot asks one
  viewer: replies with one word (10 minutes)
  game:   polls /game/poll every ~10 s: checks new words in its dictionary (action "check")
  viewer: sees the word's difficulty: 📨 to the host or ✖️ take it back (too easy / too hard)
  host:   gets "X предлагает слово ..." with ✅ принять / ❌ отклонить; a press deletes the message (popup instead)
  game:   ✅ -> on the next poll puts the word in its queue (action "queue") and answers with the round number
  viewer: is told the round (or "not in the dictionary" / "rejected")

pk: HOSTOF#<tg id> -> game the user hosts; GAMEUSERS#<game> -> linked viewers; ASK#<tg id> -> open question;
SAVED#<tiktok id> -> the viewer's words nobody found (offered again by /zagadka); CREDITS#<game> -> hint credits
as the game last reported them (/hints works after the stream too);
WQ#<game>#<id> -> one word on its way (WQIDS#<game>: the set of their ids), state:
  new -> sent (being checked) -> confirm (the viewer saw the difficulty, the host doesn't know yet; a new word
  or CONFIRM_TTL drops it) -> checked (waits for the host) -> approved -> queuing -> queued -> (played: gone)
  cancel: rejected after it reached the game's queue (old messages) -> the game drops it.
  "at" = when the state last changed, "born" = when the viewer sent it, "ok_at" = the host's ✅.
  sent/queuing without an answer for RESEND_SEC (the game restarted and lost it) go to the game again; checked
  older than CHECKED_TTL (the host never decided) is dropped and saved for the viewer, so they are never stuck
  with "your word is still waiting"; not in the game's queue STUCK_SEC after the viewer / the ✅ -> the host is
  told once, with 🔁 (give it to the game again) and ❌. /queue lists every word with its state and age.
  The host's ✅, the game's poll and a viewer's word run at once in parallel Lambdas: every change is a
  conditional write from the state just read (_move/_drop), the loser changes nothing and tells nobody,
  so a ✅ can never be overwritten by a poll that read the word a second earlier."""

import base64
import os
import re
import time
from html import escape as e

from . import events, store, tg
from .words import norm

ASK_TTL = 10 * 60
MAX_BUTTONS = 12
POLL_VERSION = 2                # games older than this only get results, no new words
OPEN = ("new", "sent", "checked", "approved", "queuing")
RESEND_SEC = 120                # sent/queuing with no answer from the game -> given to it again
CONFIRM_TTL = 30 * 60           # the viewer never pressed 📨 / ✖️ -> dropped
CHECKED_TTL = 12 * 3600         # a word the host never decided on -> dropped, saved for the viewer
STUCK_SEC = 180                 # not checked / not queued by the game this long -> the host is told
STATE_NAMES = {"new": "ждёт игру для проверки", "sent": "проверяется игрой", "checked": "ждёт твоего решения",
               "approved": "принято, ждёт игру", "queuing": "передаётся в очередь игры", "queued": "в очереди",
               "cancel": "отменяется"}

TEXT = {
    "pick": "Кто загадывает слово? Выбери зрителя:",
    "pick_none": "Не нашёл зрителей{q}. Загадывать могут только зрители, связавшие аккаунт с ботом через твою игру.",
    "asked": "🎯 Спросил <b>{name}</b> (@{tt}), жду слово. Если не ответит за 10 минут — запрос отменится.",
    "ask": "🎯 Ведущий предлагает тебе загадать слово для игры на стриме!\n\nПришли одно слово "
           "(существительное, например <b>огурец</b>). Пока раунд с твоим словом идёт, твои догадки не принимаются.",
    "ask_self": "🎯 Пришли одно слово, которое хочешь загадать (существительное, например <b>огурец</b>). "
                "Ведущий решит, брать ли его в игру. Пока раунд с твоим словом идёт, твои догадки не принимаются.",
    "need_link": "Сначала свяжи свой TikTok с ботом — напиши /start.",
    "no_host": "У этой игры пока нет ведущего в боте — загадать слово нельзя.",
    "checking": "Проверяю слово «{w}»…",
    "busy": "Твоё прошлое слово ещё ждёт проверки или решения ведущего.",
    "checked": "Слово «<b>{w}</b>» есть в словаре ✅ Жду решения ведущего.",
    "confirm": "Слово «<b>{w}</b>» есть в словаре ✅{scale}\n\nОтправить его ведущему? Если слово слишком лёгкое "
               "или трудное — отмени и загадай другое.",
    "send_host": "📨 отправить ведущему",
    "withdraw": "✖️ отменить",
    "withdrawn": "✖️ Слово «<b>{w}</b>» не отправлено. Загадать другое — /zagadka",
    "confirm_gone": "Это слово уже не ждёт решения.",
    "host_word": "🎯 <b>{name}</b> (@{tt}) предлагает слово «<b>{w}</b>»",
    "queued": "✅ Ведущий принял слово «<b>{w}</b>»! Оно будет загадано в раунде <b>{round}</b>.",
    "missing": "Слова «{w}» нет в словаре игры. Пришли другое слово.",
    "host_missing": "📕 Слово «{w}» от <b>{name}</b> (@{tt}) не найдено в словаре.",
    "rejected": "Ведущий отклонил слово «{w}».",
    "host_queued": "✅ «<b>{w}</b>» от <b>{name}</b> — раунд <b>{round}</b>",
    "queue": "📋 <b>Очередь слов</b>",
    "queue_row": "Раунд {round} — <b>{w}</b> ({name})",
    "queue_empty": "📋 Очередь слов пуста.",
    "pop_accepted": "✅ Принято: {w}",
    "pop_rejected": "❌ Отклонено: {w}",
    "too_late": "Это слово уже не отменить.",
    "pop_resent": "🔁 Отдам игре снова: {w}",
    "stuck": "⚠️ Слово «<b>{w}</b>» от <b>{name}</b> {age} не доходит до игры (сейчас: {state}). "
             "Игра запущена? 🔁 — отдать ей снова.",
    "transit_row": "⏳ «<b>{w}</b>» от <b>{name}</b> — {state}, {age}",
    "played": "🎯 Твоё слово «<b>{w}</b>» загадано прямо сейчас в раунде {round}!\n\n"
              "💡 Можешь помочь игрокам: до 3 слов-подсказок на экран — /podskazka",
    "hint_menu": "💡 Какую подсказку дать к своему слову «<b>{w}</b>»? Осталось подсказок: {n} из 3.",
    "hint_kind_word": "✏️ слово",
    "hint_kind_first": "🔤 первая буква",
    "hint_kind_len": "🔢 количество букв",
    "hint_ask": "✏️ Напиши одно слово-подсказку к «<b>{w}</b>». Оно должно быть в словаре игры.",
    "hint_checking": "💡 Проверяю «<b>{h}</b>» по словарю игры — если оно там есть, через пару секунд появится "
                     "на экране.",
    "hint_shown": "💡 Подсказка «<b>{h}</b>» появится на экране через пару секунд. Осталось: {n}.",
    "hint_on_screen": "✅ Подсказка «<b>{h}</b>» на экране. Осталось подсказок: {n}.",
    "hint_unknown": "📕 Слова «<b>{h}</b>» нет в словаре игры — подсказка не показана. Дай другую — /podskazka",
    "hint_used": "Такая подсказка уже на экране — выбери другую.",
    "hint_sponsor": "\n\n🏅 Спонсор этой функции: <b>{name}</b> (самая первая подсказка к своему слову).",
    "hint_none_left":"Все 3 подсказки уже на экране.",
    "hint_not_now": "Подсказку можно дать, только когда на стриме идёт раунд с твоим словом. "
                    "Загадать слово — /zagadka",
    "hint_over": "Раунд с твоим словом уже закончился — подсказка не нужна.",
    "hint_one_word": "Подсказка — это одно слово из букв, без пробелов и цифр. Пришли другое.",
    "hint_same": "Это почти само слово «<b>{w}</b>» — так нельзя. Пришли другое.",
    "hint_repeat": "Такая подсказка уже есть. Пришли другое слово.",
    "not_host": "Эта команда только для ведущего игры.",
    "choose": "🎯 Выбери слово из сохранённых или пришли новое (существительное). Ведущий решит, брать ли его в игру. "
              "Пока раунд с твоим словом идёт, твои догадки не принимаются.",
    "new_word": "✏️ Новое слово",
    "send_new": "Пришли новое слово (существительное, например <b>огурец</b>).",
    "ask_expired": "Запрос истёк — напиши /zagadka ещё раз.",
    "unguessed": "🎯 Твоё слово «<b>{w}</b>» никто не угадал! +1 подсказка на твой счёт, а слово сохранено — "
                 "можешь загадать его снова через /zagadka.",
    "hints": "💡 На твоём счету {n}. Потратить: напиши <b>подсказка</b> в чат стрима во время раунда.",
}


HOST_COMMANDS = ("загадывает", "pick")      # "/pick" is the same command in the host's menu
QUEUE_COMMANDS = ("очередь", "queue")       # "/queue" in the host's menu
HINTS_COMMANDS = ("подсказки", "hints", "мои подсказки")   # "/hints" in everyone's menu
VIEWER_COMMANDS = ("загадка", "zagadka")    # "/zagadka" in everyone's menu
SETTER_HINT_COMMANDS = ("подсказка", "podskazka")   # "/podskazka" in everyone's menu: works in the own word's round
MAX_SETTER_HINTS = 3
HINT_ASK_TTL = 5 * 60
SROUND_TTL = 2 * 3600            # SROUND#<game>: the round with a viewer's word now (the game reports its end)
HINT_RE = re.compile(r"[^\W\d_]+(-[^\W\d_]+)?")


SCALE_CELLS = 12
SCALE_COLORS = "🟦🟦🟦🟪🟪🟪🟪🟧🟧🟧🟥🟥"     # the game's scale: blue-violet (simple) -> red (hard)
GROUP_NAMES = {"simple": "простое", "normal": "нормальное", "hard": "сложное"}


def scale(diff):
    """the word's difficulty from the game ({"pos", "group", "ticks"}) as a line of emoji: the scale, ┃ where the
    simple words end and the hard ones start, ⚪ = the word. "" when the game sent none (not Russian)"""
    if not isinstance(diff, dict) or diff.get("group") not in GROUP_NAMES:
        return ""
    cells = list(SCALE_COLORS)
    cells[min(SCALE_CELLS - 1, max(0, int(float(diff.get("pos") or 0) * SCALE_CELLS)))] = "⚪"
    for t in sorted((diff.get("ticks") or [])[:2], reverse=True):
        cells.insert(min(SCALE_CELLS - 1, max(1, round(float(t) * SCALE_CELLS))), "┃")
    return (f"\n\nСложность: <b>{GROUP_NAMES[diff['group']]}</b>\n" + "".join(cells)
            + "\nпростые · нормальные · сложные")


def first_word(text):
    return (norm(text).split(" ", 1) or [""])[0]


def is_command(text):
    return first_word(text) in HOST_COMMANDS


def is_hints_command(text):
    return first_word(text) in HINTS_COMMANDS or norm(text) in HINTS_COMMANDS


def plural_hints(n):
    n10, n100 = n % 10, n % 100
    word = "подсказка" if n10 == 1 and n100 != 11 else \
        "подсказки" if 2 <= n10 <= 4 and not 12 <= n100 <= 14 else "подсказок"
    return f"<b>{n}</b> {word}"


def hints_command(chat, tg_id):
    """the viewer's hint credits in their current game, as the game last reported them"""
    link = store.get("TG#" + tg_id)
    if not link:
        return [(chat, TEXT["need_link"])]
    n = int((store.get("CREDITS#" + link["game"]) or {}).get("credits", {}).get(link["tiktok_id"], 0))
    return [(chat, TEXT["hints"].format(n=plural_hints(n)))]


def saved_words(tt, game):
    return [w for w in (store.get("SAVED#" + tt) or {}).get("words", []) if w.get("game") == game]


def save_word(tt, word, game, lang=""):
    item = store.get("SAVED#" + tt) or {"words": []}
    if not any(w["word"] == word and w.get("game") == game for w in item["words"]):
        item["words"].append({"word": word, "game": game, "lang": lang, "at": int(time.time())})
        store.put("SAVED#" + tt, {"words": item["words"]})


def unsave_word(tt, word, game):
    item = store.get("SAVED#" + tt) or {"words": []}
    left = [w for w in item["words"] if not (w["word"] == word and w.get("game") == game)]
    if len(left) != len(item["words"]):
        store.put("SAVED#" + tt, {"words": left})
        return True
    return False


def is_queue_command(text):
    return first_word(text) in QUEUE_COMMANDS


def queue_command(chat, tg_id):
    """the host's view of every word: queued with their rounds (deletes itself in 60 s), the ones on their way
    with state and age (🔁 / ❌), then the ones waiting for a decision (✅ / ❌)"""
    game = (store.get("HOSTOF#" + tg_id) or {}).get("game")
    if not game:
        return [(chat, TEXT["not_host"])]
    items, now = words(game), time.time()
    queued = sorted((i for i in items if i["state"] == "queued"), key=lambda i: int(i.get("round") or 10**6))
    transit = [i for i in items if i["state"] in ("new", "sent", "approved", "queuing", "cancel")]
    waiting = [i for i in items if i["state"] == "checked"]
    if not items:
        tg.send_temp(chat, TEXT["queue_empty"])
        return []
    if queued:
        tg.send_temp(chat, "\n".join([TEXT["queue"]] + [TEXT["queue_row"].format(
            round=i.get("round") or "…", w=e(i["word"].upper()), name=e(i["name"])) for i in queued]))
    for i in transit:
        tg.send(chat, TEXT["transit_row"].format(w=e(i["word"].upper()), name=e(i["name"]), state=STATE_NAMES[i["state"]],
                                                 age=_age(now - int(i.get("at") or now))),
                None if i["state"] == "cancel" else stuck_buttons(i["id"]))
    for i in waiting:                                     # the buttons again: the first message may be lost
        tg.send(chat, TEXT["host_word"].format(w=e(i["word"].upper()), name=e(i["name"]), tt=e(i["tt"])) + scale(i.get("diff")),
                decide_buttons(i["id"]))
    return []


def _age(sec):
    sec = max(0, int(sec))
    return f"{sec} с" if sec < 120 else f"{sec // 60} мин" if sec < 7200 else f"{sec // 3600} ч"


def stuck_buttons(wid):
    return tg.buttons([[("🔁 отдать игре снова", "re:" + wid), ("❌ отклонить", "rej:" + wid)]])


def decide_buttons(wid):
    return tg.buttons([[("✅ принять", "ok:" + wid), ("❌ отклонить", "rej:" + wid)]])


def is_viewer_command(text):
    return first_word(text) in VIEWER_COMMANDS


def host_command(chat, tg_id, text):
    game = (store.get("HOSTOF#" + tg_id) or {}).get("game")
    if not game:
        return [(chat, TEXT["not_host"])]
    q = (norm(text).split(" ", 1) + [""])[1].strip().lstrip("@")
    users = (store.get("GAMEUSERS#" + game) or {}).get("users", {})
    found = [(tt, u) for tt, u in users.items()             # TikTok nick/name or messenger nick/name
             if not q or any(q in norm(x) for x in (tt, u.get("name"), u.get("tg_name"), u.get("tg_full")) if x)]
    found.sort(key=lambda x: -x[1].get("at", 0))
    if not found:
        return [(chat, TEXT["pick_none"].format(q=f" по «{e(q)}»" if q else ""))]
    rows = [[(f"{u.get('name') or tt} (@{tt})"[:48], "pick:" + tt)] for tt, u in found[:MAX_BUTTONS]]
    return [(chat, TEXT["pick"], tg.buttons(rows))]


def viewer_command(chat, tg_id, now=None):
    """a linked viewer offers a word themselves"""
    now = now or time.time()
    link = store.get("TG#" + tg_id)
    if not link:
        return [(chat, TEXT["need_link"])]
    game = link["game"]
    owner = store.get("OWNER#" + game)
    if not owner:
        return [(chat, TEXT["no_host"])]
    if _open_item(game, tg_id, now):
        return [(chat, TEXT["busy"])]
    store.put("ASK#" + tg_id, {"game": game, "host": owner["chat"], "tt": link["tiktok_id"],
                               "name": link.get("tiktok_name", "")}, ttl=now + ASK_TTL)
    events.log(game, "ask_self", tt=link["tiktok_id"])
    saved = saved_words(link["tiktok_id"], game)
    if saved:                                             # their unguessed words, or a new one
        rows = [[(w["word"].upper(), "use:" + w["word"])] for w in saved[:MAX_BUTTONS]]
        return [(chat, TEXT["choose"], tg.buttons(rows + [[(TEXT["new_word"], "new")]]), True)]   # transient
    return [(chat, TEXT["ask_self"], None, True)]


def is_setter_hint_command(text):
    return first_word(text) in SETTER_HINT_COMMANDS


def _setter_round(tg_id):
    """(link, the round with this viewer's word if it is on now)"""
    link = store.get("TG#" + tg_id)
    sr = store.get("SROUND#" + link["game"]) if link else None
    return link, (sr if sr and sr.get("tg") == tg_id else None)


def _same_root(a, b):
    """the hint gives the word away: the word itself or the same start ("санка" for "санки", "кот" - "котёнок")"""
    return len(os.path.commonprefix([a, b])) >= min(4, len(a), len(b))


def setter_hint_command(chat, tg_id, text, now=None):
    """the viewer whose word is played now: "/podskazka" -> asks for the word, "/podskazka зима" -> takes it"""
    now = now or time.time()
    link, sr = _setter_round(tg_id)
    if not link:
        return [(chat, TEXT["need_link"])]
    if not sr:
        return [(chat, TEXT["hint_not_now"])]
    if len(sr["hints"]) >= MAX_SETTER_HINTS:
        return [(chat, TEXT["hint_none_left"])]
    rest = (text.strip().split(None, 1) + [""])[1].strip()
    if rest:
        return setter_hint_word(chat, tg_id, rest, now)
    from .handler import sponsor_name, sponsor_photo     # (circular import otherwise)
    sp = sponsor_name("podskazka")
    text = TEXT["hint_menu"].format(w=e(sr["word"].upper()), n=MAX_SETTER_HINTS - len(sr["hints"])) \
        + (TEXT["hint_sponsor"].format(name=e(sp)) if sp else "")
    markup = hint_buttons(sr)
    if sp and sponsor_photo("podskazka", chat, text, markup):   # the sponsor's TikTok avatar with the text under it
        return []
    return [(chat, text, markup)]


def plural_letters(n):
    n10, n100 = n % 10, n % 100
    return "буква" if n10 == 1 and n100 != 11 else "буквы" if 2 <= n10 <= 4 and not 12 <= n100 <= 14 else "букв"


def free_hint(sr, kind):
    """a hint the bot makes from the word itself: "к…" (the first letter) or "5 букв" (no dictionary check)"""
    if kind == "first":
        return sr["word"][:1].lower() + "…"
    n = sum(ch.isalpha() for ch in sr["word"])
    return f"{n} {plural_letters(n)}"


def hint_buttons(sr):
    """the three kinds; the first letter / the number of letters only while not on screen yet"""
    rows = [[(TEXT["hint_kind_word"], "hk:word")]]
    for kind in ("first", "len"):
        if free_hint(sr, kind) not in sr["hints"]:
            rows.append([(TEXT["hint_kind_" + kind], "hk:" + kind)])
    return tg.buttons(rows)


def setter_hint_kind(cb, tg_id, chat, mid, kind, now=None):
    """the setter picked a kind: a word -> asks for it; the first letter / the number of letters -> on screen"""
    now = now or time.time()
    tg.answer(cb.get("id"))
    tg.drop_buttons(chat, mid)
    link, sr = _setter_round(tg_id)
    if not sr:
        tg.send(chat, TEXT["hint_over" if link else "need_link"])
    elif len(sr["hints"]) >= MAX_SETTER_HINTS:
        tg.send(chat, TEXT["hint_none_left"])
    elif kind == "word":
        store.put("HINTASK#" + tg_id, {"game": link["game"]}, ttl=now + HINT_ASK_TTL)
        tg.send(chat, TEXT["hint_ask"].format(w=e(sr["word"].upper())))
    elif kind in ("first", "len"):
        for c, text in _add_hint(chat, tg_id, link, sr, free_hint(sr, kind), now, free=True):
            tg.send(c, text)


def setter_hint_word(chat, tg_id, text, now=None):
    """one hint word: checked here, kept in SROUND#<game>; the game checks it in its dictionary on its next poll"""
    now = now or time.time()
    link, sr = _setter_round(tg_id)
    if not sr:
        store.delete("HINTASK#" + tg_id)
        return [(chat, TEXT["hint_over" if link else "need_link"])]
    if len(sr["hints"]) >= MAX_SETTER_HINTS:
        store.delete("HINTASK#" + tg_id)
        return [(chat, TEXT["hint_none_left"])]
    words = text.strip().lower().split()
    if len(words) != 1 or len(words[0]) > 24 or not HINT_RE.fullmatch(words[0]):
        return [(chat, TEXT["hint_one_word"])]
    h = words[0]
    if _same_root(norm(h), norm(sr["word"])):
        return [(chat, TEXT["hint_same"].format(w=e(sr["word"].upper())))]
    return _add_hint(chat, tg_id, link, sr, h, now)


def _add_hint(chat, tg_id, link, sr, h, now, free=False):
    """a hint into SROUND#<game> ("free" ones need no dictionary check); the game gets it on its next poll"""
    if norm(h) in [norm(x) for x in sr["hints"]]:
        return [(chat, TEXT["hint_used" if free else "hint_repeat"])]
    sr["hints"].append(h)
    sr["ver"] = int(sr.get("ver") or 0) + 1               # hint_verdicts writes only over the hints it read
    if free:
        sr["free"] = sr.get("free", []) + [h]
    store.put("SROUND#" + link["game"], sr, ttl=now + SROUND_TTL)
    store.delete("HINTASK#" + tg_id)
    events.log(link["game"], "setter_hint", tt=sr["tt"], word=h)
    if not store.get("SPONSOR#podskazka"):                # the first ever: the feature's sponsor, in everyone's menu
        from .handler import refresh_menus
        store.put("SPONSOR#podskazka", {"tt": sr["tt"], "name": link.get("tiktok_name", "")})
        refresh_menus()
    if free:
        return [(chat, TEXT["hint_shown"].format(h=e(h.upper()), n=MAX_SETTER_HINTS - len(sr["hints"])))]
    return [(chat, TEXT["hint_checking"].format(h=e(h.upper())))]


def hint_verdicts(gid, sr, cur):
    """the game's word on the setter's hint words: not in its dictionary -> taken back (the setter is told),
    on screen -> the setter is told once. Written only if no hint came meanwhile (the next poll otherwise)."""
    bad = [h for h in sr["hints"] if h in (cur.get("rejected") or ())]
    new = [h for h in cur.get("shown") or () if h in sr["hints"] and h not in sr.get("told", [])
           and h not in sr.get("free", [])]
    if not bad and not new:
        return sr
    hints, told, ver = [h for h in sr["hints"] if h not in bad], sr.get("told", []) + new, int(sr.get("ver") or 0)
    if not store.update("SROUND#" + gid, {"hints": hints, "told": told, "ver": ver + 1}, {"ver": ver}):
        return sr
    for h in bad:
        tg.send(sr["chat"], TEXT["hint_unknown"].format(h=e(h.upper())))
        events.log(gid, "setter_hint_unknown", tt=sr["tt"], word=h)
    for h in new:
        tg.send(sr["chat"], TEXT["hint_on_screen"].format(h=e(h.upper()), n=MAX_SETTER_HINTS - len(hints)))
    return dict(sr, hints=hints, told=told, ver=ver + 1)


def add_game_user(game, link):
    """called on every link: the host can pick this viewer later"""
    item = store.get("GAMEUSERS#" + game) or {"users": {}}
    item["users"][link["tiktok_id"]] = {"name": link.get("tiktok_name", ""), "tg": link["tg"], "chat": link["chat"],
                                        "at": link["at"], "tg_name": link.get("tg_name", ""),
                                        "tg_full": link.get("tg_full", "")}
    store.put("GAMEUSERS#" + game, {"users": item["users"]})


def on_callback(cb, now=None):
    now = now or time.time()
    user = cb.get("from") or {}
    tg_id = str(user.get("id"))
    msg = cb.get("message") or {}
    chat, mid = (msg.get("chat") or {}).get("id"), msg.get("message_id")
    data = cb.get("data") or ""
    if data.startswith("use:") or data == "new":          # a viewer chose a saved word / a new one
        return viewer_choice(cb, tg_id, chat, mid, data)
    if data.startswith("go:") or data.startswith("no:"):  # a viewer: their checked word to the host, or not
        return viewer_confirm(cb, tg_id, chat, mid, data)
    if data.startswith("hk:"):                            # the setter: a kind of hint
        return setter_hint_kind(cb, tg_id, chat, mid, data[3:], now)
    game = (store.get("HOSTOF#" + tg_id) or {}).get("game")
    if not game:
        tg.answer(cb.get("id"))
        return
    if data.startswith("ok:") or data.startswith("rej:"):
        return decide(cb, game, chat, mid, data)
    if data.startswith("re:"):
        return resend(cb, game, chat, mid, data[3:])
    tg.answer(cb.get("id"))
    if data.startswith("pick:"):
        tt = data[5:]
        u = (store.get("GAMEUSERS#" + game) or {}).get("users", {}).get(tt)
        if not u:
            return
        store.put("ASK#" + u["tg"], {"game": game, "host": chat, "tt": tt, "name": u.get("name", "")}, ttl=now + ASK_TTL)
        events.log(game, "ask", tt=tt, host=tg_id)
        tg.send(u["chat"], TEXT["ask"])
        tg.edit(chat, mid, TEXT["asked"].format(name=e(u.get("name") or tt), tt=e(tt)))


def viewer_choice(cb, tg_id, chat, mid, data):
    tg.answer(cb.get("id"))
    ask = store.get("ASK#" + tg_id)
    if not ask:
        tg.edit(chat, mid, TEXT["ask_expired"])
        return
    if data == "new":
        tg.edit(chat, mid, TEXT["send_new"])
        return
    word = data[4:]
    if not unsave_word(ask["tt"], word, ask["game"]):     # pressed twice / already used
        tg.edit(chat, mid, TEXT["busy"])
        return
    out = viewer_word(ask, chat, tg_id, word, from_saved=True)
    tg.edit(chat, mid, out[0][1])


def viewer_confirm(cb, tg_id, chat, mid, data):
    """the viewer saw their word's difficulty: 📨 -> the host decides; ✖️ -> dropped (a saved word stays saved)"""
    go, wid = data.startswith("go:"), data[3:]
    game = (store.get("TG#" + tg_id) or {}).get("game")
    it = store.get(_pk(game, wid)) if game else None
    if not it or it["tg"] != tg_id or it["state"] != "confirm":
        tg.answer(cb.get("id"), TEXT["confirm_gone"])
        tg.drop_buttons(chat, mid)
        return
    w = e(it["word"].upper())
    if go and _move(game, it, "confirm", state="checked", at=int(time.time())):
        tg.answer(cb.get("id"))
        tg.edit(chat, mid, TEXT["checked"].format(w=w) + scale(it.get("diff")))
        tg.mark_transient(chat, mid)                      # goes when the next message comes
        tg.send(it["host"], TEXT["host_word"].format(w=w, name=e(it["name"]), tt=e(it["tt"]))
                + scale(it.get("diff")), decide_buttons(it["id"]))
        events.log(game, "word_offered", id=wid, word=it["word"], tt=it["tt"])
    elif not go and _drop(game, it, "confirm"):
        if it.get("saved"):
            save_word(it["tt"], it["word"], game)
        tg.answer(cb.get("id"))
        tg.edit(chat, mid, TEXT["withdrawn"].format(w=w))
        events.log(game, "word_withdrawn", id=wid, word=it["word"], tt=it["tt"])
    else:
        tg.answer(cb.get("id"), TEXT["confirm_gone"])
        tg.drop_buttons(chat, mid)


def decide(cb, game, chat, mid, data):
    """the host's ✅/❌ on an offered word: popup, the message disappears, the decision goes to the journal.
    Each change is conditional on the state just read; a poll that got there first -> read again and retry."""
    accept = data.startswith("ok:")
    wid = data.split(":", 1)[1]
    for _ in range(3):
        it = store.get(_pk(game, wid))
        if not it or it["state"] == "cancel" or (accept and it["state"] in ("new", "sent")):
            break
        now = int(time.time())
        if accept:                                        # the game queues it on its next poll
            done = it["state"] != "checked" or _move(game, it, "checked", state="approved", at=now, ok_at=now)
        elif it["state"] in ("new", "sent", "checked", "approved"):   # never reached the game's queue
            done = _drop(game, it, it["state"])
            if done and it.get("saved"):                  # a saved word stays saved
                save_word(it["tt"], it["word"], game)
        else:                                             # already in the game's queue (old messages)
            done = _move(game, it, it["state"], state="cancel", at=now)
        if done:
            if not accept:
                tg.send(it["chat"], TEXT["rejected"].format(w=e(it["word"])))
            tg.answer(cb.get("id"), TEXT["pop_accepted" if accept else "pop_rejected"].format(w=it["word"].upper()))
            tg.delete(chat, mid)
            events.log(game, "word_accepted" if accept else "word_rejected", id=wid, word=it["word"], tt=it["tt"])
            return
    tg.answer(cb.get("id"), TEXT["too_late"])
    tg.delete(chat, mid)


def resend(cb, game, chat, mid, wid):
    """the host's 🔁 on a word stuck on its way to the game: given to it again on the next poll"""
    it = store.get(_pk(game, wid))
    back = {"new": "new", "sent": "new", "approved": "approved", "queuing": "approved"}.get((it or {}).get("state"))
    if not back or not _move(game, it, it["state"], state=back, at=int(time.time()), warned=0):
        tg.answer(cb.get("id"), TEXT["too_late"])
    else:
        tg.answer(cb.get("id"), TEXT["pop_resent"].format(w=it["word"].upper()))
        events.log(game, "word_resent", id=wid, word=it["word"], tt=it["tt"], by="host")
    tg.delete(chat, mid)


def _pk(gid, wid):
    return f"WQ#{gid}#{wid}"


def words(gid):
    """the game's words on their way, oldest first: WQIDS#<game> (a set of ids) -> WQ#<game>#<id> each"""
    out = []
    for wid in (store.get("WQIDS#" + gid) or {}).get("ids") or ():
        it = store.get(_pk(gid, wid))
        if it:
            out.append(it)
        else:                                             # deleted by a writer that died before the set
            store.set_remove("WQIDS#" + gid, "ids", wid)
    return sorted(out, key=lambda i: (int(i.get("born") or i.get("at") or 0), i["id"]))


def _add(gid, it):
    store.put(_pk(gid, it["id"]), it)
    store.set_add("WQIDS#" + gid, "ids", it["id"])


def _move(gid, it, expect, **changes):
    """change a word only if it is still in the state expected (a tuple: one of these); True if done.
    A writer that loses the race changes nothing and says nothing to anyone."""
    if not store.update(_pk(gid, it["id"]), changes, {"state": expect}):
        events.log(gid, "word_race", id=it["id"], word=it["word"], want=changes.get("state", ""))
        return False
    it.update(changes)
    return True


def _drop(gid, it, expect=None):
    """delete a word (only if still in the state expected, when given); True if it was there and is gone"""
    if not store.delete_if(_pk(gid, it["id"]), {"state": expect} if expect else {}):
        return False
    store.set_remove("WQIDS#" + gid, "ids", it["id"])
    return True


def _viewer_open(game, tg_id, now):
    """this viewer's undecided words past CHECKED_TTL are dropped (saved for them, like a word nobody found);
    True if they still have a word on its way"""
    busy = False
    for i in words(game):
        if i["tg"] != tg_id:
            continue
        if i["state"] == "checked" and now - int(i.get("at") or 0) > CHECKED_TTL and _drop(game, i, "checked"):
            save_word(i["tt"], i["word"], game)
            events.log(game, "word_expired", id=i["id"], word=i["word"], tt=i["tt"])
        elif i["state"] == "confirm":                     # never sent to the host: a new word replaces it
            _drop_unconfirmed(game, i)
        elif i["state"] in OPEN:
            busy = True
    return busy


def _drop_unconfirmed(game, it):
    if _drop(game, it, "confirm"):
        if it.get("saved"):
            save_word(it["tt"], it["word"], game)
        events.log(game, "word_unconfirmed", id=it["id"], word=it["word"], tt=it["tt"])
        return True
    return False


def _open_item(game, tg_id, now=None):
    return _viewer_open(game, tg_id, now or time.time())


def viewer_word(ask, chat, tg_id, text, now=None, from_saved=False):
    """the asked viewer sent their word -> waits for the game's dictionary check"""
    now = now or time.time()
    game = ask["game"]
    if _viewer_open(game, tg_id, now):
        return [(chat, TEXT["busy"])]
    word = text.strip().split()[0][:30]
    _add(game, {"id": base64.urlsafe_b64encode(os.urandom(6)).decode(), "word": word, "tt": ask["tt"],
                "name": ask["name"], "tg": tg_id, "chat": chat, "host": ask["host"], "state": "new",
                "saved": from_saved, "at": int(now), "born": int(now)})
    events.log(game, "word_sent", tt=ask["tt"], word=word)
    return [(chat, TEXT["checking"].format(w=e(word)), None, True)]   # transient: gone after the next one


def rename(gid, names, items):
    """the game reports viewers' current nicknames; linked ones get them everywhere the bot keeps a name"""
    gu = store.get("GAMEUSERS#" + gid) or {"users": {}}
    hit = {tt: n for tt, n in names.items() if tt in gu["users"] and gu["users"][tt].get("name") != n}
    for tt, n in hit.items():
        gu["users"][tt]["name"] = n
        for pk in ("TT#" + tt, "TG#" + gu["users"][tt]["tg"]):
            link = store.get(pk)
            if link and link.get("tiktok_name") != n:
                link["tiktok_name"] = n
                store.put(pk, link)
        events.log(gid, "rename", tt=tt, name=n)
    if hit:
        store.put("GAMEUSERS#" + gid, {"users": gu["users"]})
        sp = store.get("SPONSOR#podskazka")
        if sp and sp["tt"] in hit:                        # the sponsor's new nickname in everyone's menu
            from .handler import refresh_menus
            refresh_menus()
    for i in items.values():                              # words on their way show the new name too
        if i["tt"] in names and i.get("name") != names[i["tt"]] and store.update(_pk(gid, i["id"]),
                                                                                 {"name": names[i["tt"]]}):
            i["name"] = names[i["tt"]]


MISSING_MSG_SEC = 30                 # the host's "not in the dictionary" note disappears after this


def save_missing(gid, it):
    """words players offered that the game's dictionary doesn't know: kept per game and month for the
    superadmin (MISSING#<game>#<YYYY-MM>, list "words") - to extend the dictionaries later"""
    month = time.strftime("%Y-%m", time.gmtime())
    store.append(f"MISSING#{gid}#{month}", "words",
                 {"word": it["word"], "tt": it["tt"], "name": it.get("name", ""), "t": time.time()})


def game_poll(game, body):
    """the game's results (dictionary checks, queue places, started rounds), then work for it"""
    gid = game["id"]
    from .handler import check_instance_twin           # (circular import otherwise)
    now = time.time()
    check_instance_twin(game, str(body.get("instance") or ""), now)
    items = {i["id"]: i for i in words(gid)}
    for r in body.get("results") or []:                   # each change only from the state the answer is about:
        it = items.get(r.get("id"))                       # a word the host decided on meanwhile stays decided
        if not it:
            continue
        w = e((r.get("word") or it["word"]).upper())
        if r.get("stage") == "queue":
            if r.get("ok"):
                if _move(gid, it, ("queuing", "approved"), state="queued", round=r.get("round"), at=int(now)):
                    tg.send(it["chat"], TEXT["queued"].format(w=w, round=it["round"]))
                    tg.send_temp(it["host"], TEXT["host_queued"].format(w=w, name=e(it["name"]), round=it["round"]))
                    events.log(gid, "word_queued", tt=it["tt"], word=it["word"], round=it["round"])
            elif _drop(gid, it, ("queuing", "approved")):  # e.g. the game's language changed meanwhile
                del items[it["id"]]
                tg.send(it["chat"], TEXT["missing"].format(w=e(it["word"])))
                events.log(gid, "word_missing", tt=it["tt"], word=it["word"])
        elif r.get("ok"):                                 # in the dictionary: the viewer sees how hard, then the host
            ch = {"state": "confirm", "word": r.get("word") or it["word"], "at": int(now)}
            if isinstance(r.get("diff"), dict):
                ch["diff"] = r["diff"]                    # the scale again when the host lists the waiting words
            if _move(gid, it, ("new", "sent"), **ch):
                store.delete("ASK#" + it["tg"])
                tg.send(it["chat"], TEXT["confirm"].format(w=w, scale=scale(it.get("diff"))),
                        tg.buttons([[(TEXT["send_host"], "go:" + it["id"]), (TEXT["withdraw"], "no:" + it["id"])]]))
                events.log(gid, "word_checked", tt=it["tt"], word=it["word"])
        elif _drop(gid, it, ("new", "sent")):
            del items[it["id"]]
            tg.send(it["chat"], TEXT["missing"].format(w=e(it["word"])))
            tg.send_temp(it["host"], TEXT["host_missing"].format(w=e(it["word"]), name=e(it["name"]), tt=e(it["tt"])),
                         MISSING_MSG_SEC)
            save_missing(gid, it)
            events.log(gid, "word_missing", tt=it["tt"], word=it["word"])
    from .reports import answer, pending
    answer(gid, body.get("answers"))                   # the host's /round, /history: the game's data
    for u in body.get("unguessed") or []:                 # nobody found it: +1 hint (in the game), word saved
        tt = (u.get("tiktok_id") or "").lower()
        if not tt or not u.get("word"):
            continue
        save_word(tt, u["word"], gid, u.get("lang", ""))
        link = store.get("TT#" + tt)
        if link:
            tg.send(link["chat"], TEXT["unguessed"].format(w=e(u["word"].upper())))
        events.log(gid, "word_unguessed", tt=tt, word=u["word"])
    if body.get("names"):                                 # nicknames change: keep linked viewers' current
        rename(gid, {k.lower(): v for k, v in body["names"].items() if v}, items)
    for tt, url in (body.get("avatars") or {}).items():   # linked viewers' TikTok avatars: a new picture, or daily
        link = store.get("TT#" + tt.lower())
        if link and str(url).startswith("https://") and link.get("avatar") != url:
            store.put("TT#" + tt.lower(), dict(link, avatar=url))
    if body.get("credits"):                               # hint credits as they are now (only changes come)
        cur = (store.get("CREDITS#" + gid) or {}).get("credits", {})
        cur.update({k.lower(): int(v) for k, v in body["credits"].items()})
        store.put("CREDITS#" + gid, {"credits": {k: v for k, v in cur.items() if v}})
    for pid in body.get("played") or []:
        it = items.pop(pid, None)
        if it and _drop(gid, it):
            tg.send(it["chat"], TEXT["played"].format(w=e(it["word"].upper()), round=it.get("round", "")))
            events.log(gid, "word_played", tt=it["tt"], word=it["word"], round=it.get("round"))
            store.put("SROUND#" + gid, {"id": pid, "tg": it["tg"], "chat": it["chat"], "tt": it["tt"],
                                        "word": it["word"], "round": it.get("round"), "hints": [], "ver": 0},
                      ttl=now + SROUND_TTL)
    real = set(body.get("queue_ids") or ())               # the game's real queue: what isn't there is done
    for i in list(items.values()):                        # (played or lost, e.g. a report lost in a restart)
        if "queue_ids" in body and i["state"] == "queued" and i["id"] not in real:
            if _drop(gid, i, "queued"):
                del items[i["id"]]
                events.log(gid, "word_dropped", tt=i["tt"], word=i["word"], round=i.get("round"))
        elif i["state"] == "queuing" and i["id"] in real:  # given to the game, the answer never came (a restart):
            _move(gid, i, "queuing", state="queued", at=int(now))   # it is in the game's queue, only the report was lost
        elif i["state"] == "confirm" and now - int(i.get("at") or 0) > CONFIRM_TTL:
            if _drop_unconfirmed(gid, i):
                del items[i["id"]]
        elif i["state"] in ("sent", "queuing") and now - int(i.get("at") or 0) > RESEND_SEC:
            if _move(gid, i, i["state"], state="new" if i["state"] == "sent" else "approved", at=int(now)):
                events.log(gid, "word_resent", tt=i["tt"], word=i["word"])
    for i in items.values():                              # still not in the game's queue long after: tell the host
        since = int(i.get("ok_at") or i.get("at") or 0) if i["state"] in ("approved", "queuing") \
            else int(i.get("born") or i.get("at") or 0)
        if i["state"] in ("new", "sent", "approved", "queuing") and not i.get("warned") \
                and now - since > STUCK_SEC and _move(gid, i, i["state"], warned=1):
            tg.send(i["host"], TEXT["stuck"].format(w=e(i["word"].upper()), name=e(i["name"]),
                                                    state=STATE_NAMES[i["state"]], age=_age(now - since)),
                    stuck_buttons(i["id"]))
            events.log(gid, "word_stuck", id=i["id"], word=i["word"], state=i["state"])
    todo = []
    if (body.get("v") or 1) >= POLL_VERSION:
        for i in items.values():
            if i["state"] in ("new", "approved") and _move(gid, i, i["state"], at=int(now),
                                                           state="sent" if i["state"] == "new" else "queuing"):
                todo.append({"id": i["id"], "word": i["word"], "tiktok_id": i["tt"], "name": i["name"],
                             "action": "check" if i["state"] == "sent" else "queue"})
    cancel = [i["id"] for i in items.values() if i["state"] == "cancel" and _drop(gid, i, "cancel")]
    out = {"words": todo, "cancel": cancel, "requests": pending(gid)}
    if "setter" in body:                                  # the round with a viewer's word: {id, hints shown} or null
        cur = body["setter"] or {}
        sr = store.get("SROUND#" + gid)
        if sr and sr["id"] != cur.get("id"):              # that round is over: no more hints
            store.delete("SROUND#" + gid)
            sr = None
        if not sr and cur.get("id") and cur.get("tiktok_id"):   # "played" lost (a restart at the round's start)
            link = store.get("TT#" + cur["tiktok_id"].lower())
            if link and link.get("game") == gid:
                sr = {"id": cur["id"], "tg": link["tg"], "chat": link["chat"], "tt": link["tiktok_id"],
                      "word": cur.get("word", ""), "round": cur.get("round"), "hints": [], "ver": 0}
                store.put("SROUND#" + gid, sr, ttl=now + SROUND_TTL)
        if sr:
            sr = hint_verdicts(gid, sr, cur)
        if sr and len(sr["hints"]) > int(cur.get("hints") or 0):
            out["setter_hints"] = {"id": sr["id"], "words": sr["hints"], "free": sr.get("free", [])}
    if body.get("want_links"):                            # the room page: a player's Telegram next to their TikTok
        users = (store.get("GAMEUSERS#" + gid) or {}).get("users", {})
        out["links"] = {tt: {"tg": u.get("tg_name", ""), "id": u.get("tg", ""), "full": u.get("tg_full", "")}
                        for tt, u in users.items()}
    return 200, out
