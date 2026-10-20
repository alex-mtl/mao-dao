"""Words viewers pick for the guess game. The host always decides: nothing goes into a round without ✅.

  a word comes two ways:
    viewer: "/zagadka" (menu) or "загадка" -> the bot asks for a word (only viewers linked to a game)
    host:   "загадывает [part of a nick]" or "/pick" -> buttons with the game's linked viewers -> the bot asks one
  viewer: replies with one word (10 minutes)
  game:   polls /game/poll every ~10 s: checks new words in its dictionary (action "check")
  host:   gets "X предлагает слово ..." with ✅ принять / ❌ отклонить; a press deletes the message (popup instead)
  game:   ✅ -> on the next poll puts the word in its queue (action "queue") and answers with the round number
  viewer: is told the round (or "not in the dictionary" / "rejected")

pk: HOSTOF#<tg id> -> game the user hosts; GAMEUSERS#<game> -> linked viewers; ASK#<tg id> -> open question;
SAVED#<tiktok id> -> the viewer's words nobody found (offered again by /zagadka); CREDITS#<game> -> hint credits
as the game last reported them (/hints works after the stream too);
PEND#<game> -> words on their way, state:
  new -> sent (being checked) -> checked (waits for the host) -> approved -> queuing -> queued -> (played: gone)
  cancel: rejected after it reached the game's queue (old messages) -> the game drops it."""

import base64
import os
import time
from html import escape as e

from . import events, store, tg
from .words import norm

ASK_TTL = 10 * 60
MAX_BUTTONS = 12
POLL_VERSION = 2                # games older than this only get results, no new words
OPEN = ("new", "sent", "checked", "approved", "queuing")

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
    "host_word": "🎯 <b>{name}</b> (@{tt}) предлагает слово «<b>{w}</b>»",
    "queued": "✅ Ведущий принял слово «<b>{w}</b>»! Оно будет загадано в раунде <b>{round}</b>.",
    "missing": "Слова «{w}» нет в словаре игры. Пришли другое слово.",
    "host_missing": "📕 Слово «{w}» от <b>{name}</b> (@{tt}) не найдено в словаре.",
    "rejected": "Ведущий отклонил слово «{w}».",
    "host_queued": "✅ «<b>{w}</b>» от <b>{name}</b> — раунд <b>{round}</b>",
    "queue": "📋 <b>Очередь слов</b>",
    "queue_row": "Раунд {round} — <b>{w}</b> ({name})",
    "queue_wait": "⏳ <b>Ждут решения</b>",
    "queue_wait_row": "<b>{w}</b> ({name})",
    "queue_empty": "📋 Очередь слов пуста.",
    "pop_accepted": "✅ Принято: {w}",
    "pop_rejected": "❌ Отклонено: {w}",
    "too_late": "Это слово уже не отменить.",
    "played": "🎯 Твоё слово «<b>{w}</b>» загадано прямо сейчас в раунде {round}!",
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
    """the host's view of the words: queued with their rounds, then the ones waiting for a decision.
    The answer deletes itself in 60 s."""
    game = (store.get("HOSTOF#" + tg_id) or {}).get("game")
    if not game:
        return [(chat, TEXT["not_host"])]
    items = (store.get("PEND#" + game) or {"items": []})["items"]
    queued = sorted((i for i in items if i["state"] in ("approved", "queuing", "queued")),
                    key=lambda i: int(i.get("round") or 10**6))
    waiting = [i for i in items if i["state"] == "checked"]
    if not queued and not waiting:
        tg.send_temp(chat, TEXT["queue_empty"])
        return []
    lines = []
    if queued:
        lines += [TEXT["queue"]] + [TEXT["queue_row"].format(round=i.get("round") or "…", w=e(i["word"].upper()),
                                                            name=e(i["name"])) for i in queued]
    if waiting:
        lines += ([""] if lines else []) + [TEXT["queue_wait"]] + \
                 [TEXT["queue_wait_row"].format(w=e(i["word"].upper()), name=e(i["name"])) for i in waiting]
    tg.send_temp(chat, "\n".join(lines))
    return []


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
    if _open_item(game, tg_id):
        return [(chat, TEXT["busy"])]
    store.put("ASK#" + tg_id, {"game": game, "host": owner["chat"], "tt": link["tiktok_id"],
                               "name": link.get("tiktok_name", "")}, ttl=now + ASK_TTL)
    events.log(game, "ask_self", tt=link["tiktok_id"])
    saved = saved_words(link["tiktok_id"], game)
    if saved:                                             # their unguessed words, or a new one
        rows = [[(w["word"].upper(), "use:" + w["word"])] for w in saved[:MAX_BUTTONS]]
        return [(chat, TEXT["choose"], tg.buttons(rows + [[(TEXT["new_word"], "new")]]))]
    return [(chat, TEXT["ask_self"])]


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
    game = (store.get("HOSTOF#" + tg_id) or {}).get("game")
    if not game:
        tg.answer(cb.get("id"))
        return
    if data.startswith("ok:") or data.startswith("rej:"):
        return decide(cb, game, chat, mid, data)
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


def decide(cb, game, chat, mid, data):
    """the host's ✅/❌ on an offered word: popup, the message disappears, the decision goes to the journal"""
    accept = data.startswith("ok:")
    wid = data.split(":", 1)[1]
    pend = store.get("PEND#" + game) or {"items": []}
    it = next((i for i in pend["items"] if i["id"] == wid), None)
    if not it or it["state"] == "cancel" or (not accept and it["state"] not in ("checked", "approved", "queuing",
                                                                               "queued")):
        tg.answer(cb.get("id"), TEXT["too_late"])
        tg.delete(chat, mid)
        return
    w = it["word"].upper()
    if accept:
        if it["state"] == "checked":
            it["state"] = "approved"                      # the game queues it on its next poll
    elif it["state"] in ("checked", "approved"):          # never reached the game's queue
        pend["items"].remove(it)
        tg.send(it["chat"], TEXT["rejected"].format(w=e(it["word"])))
        if it.get("saved"):                               # a saved word stays saved
            save_word(it["tt"], it["word"], game)
    else:                                                 # already in the game's queue (old messages)
        it["state"] = "cancel"
        tg.send(it["chat"], TEXT["rejected"].format(w=e(it["word"])))
    store.put("PEND#" + game, {"items": pend["items"]})
    tg.answer(cb.get("id"), TEXT["pop_accepted" if accept else "pop_rejected"].format(w=w))
    tg.delete(chat, mid)
    events.log(game, "word_accepted" if accept else "word_rejected", id=wid, word=it["word"], tt=it["tt"])


def _open_item(game, tg_id):
    pend = store.get("PEND#" + game) or {"items": []}
    return any(i["tg"] == tg_id and i["state"] in OPEN for i in pend["items"])


def viewer_word(ask, chat, tg_id, text, now=None, from_saved=False):
    """the asked viewer sent their word -> waits for the game's dictionary check"""
    game = ask["game"]
    pend = store.get("PEND#" + game) or {"items": []}
    if any(i["tg"] == tg_id and i["state"] in OPEN for i in pend["items"]):
        return [(chat, TEXT["busy"])]
    word = text.strip().split()[0][:30]
    pend["items"].append({"id": base64.urlsafe_b64encode(os.urandom(6)).decode(), "word": word, "tt": ask["tt"],
                          "name": ask["name"], "tg": tg_id, "chat": chat, "host": ask["host"], "state": "new",
                          "saved": from_saved})
    store.put("PEND#" + game, {"items": pend["items"]})
    events.log(game, "word_sent", tt=ask["tt"], word=word)
    return [(chat, TEXT["checking"].format(w=e(word)))]


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
    for i in items.values():                              # words on their way show the new name too
        if i["tt"] in names:
            i["name"] = names[i["tt"]]


def game_poll(game, body):
    """the game's results (dictionary checks, queue places, started rounds), then work for it"""
    gid = game["id"]
    pend = store.get("PEND#" + gid) or {"items": []}
    items = {i["id"]: i for i in pend["items"]}
    changed = False
    for r in body.get("results") or []:
        it = items.get(r.get("id"))
        if not it:
            continue
        changed = True
        w = e((r.get("word") or it["word"]).upper())
        if r.get("stage") == "queue":
            if r.get("ok"):
                it.update(state="queued", round=r.get("round"))
                tg.send(it["chat"], TEXT["queued"].format(w=w, round=it["round"]))
                tg.send_temp(it["host"], TEXT["host_queued"].format(w=w, name=e(it["name"]), round=it["round"]))
                events.log(gid, "word_queued", tt=it["tt"], word=it["word"], round=it["round"])
            else:                                         # e.g. the game's language changed meanwhile
                del items[it["id"]]
                tg.send(it["chat"], TEXT["missing"].format(w=e(it["word"])))
                events.log(gid, "word_missing", tt=it["tt"], word=it["word"])
        elif r.get("ok"):                                 # in the dictionary: the host decides
            it.update(state="checked", word=r.get("word") or it["word"])
            store.delete("ASK#" + it["tg"])
            tg.send(it["chat"], TEXT["checked"].format(w=w))
            tg.send(it["host"], TEXT["host_word"].format(w=w, name=e(it["name"]), tt=e(it["tt"])),
                    tg.buttons([[("✅ принять", "ok:" + it["id"]), ("❌ отклонить", "rej:" + it["id"])]]))
            events.log(gid, "word_checked", tt=it["tt"], word=it["word"])
        else:
            del items[it["id"]]
            tg.send(it["chat"], TEXT["missing"].format(w=e(it["word"])))
            tg.send(it["host"], TEXT["host_missing"].format(w=e(it["word"]), name=e(it["name"]), tt=e(it["tt"])))
            events.log(gid, "word_missing", tt=it["tt"], word=it["word"])
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
        changed = True
    if body.get("credits"):                               # hint credits as they are now (only changes come)
        cur = (store.get("CREDITS#" + gid) or {}).get("credits", {})
        cur.update({k.lower(): int(v) for k, v in body["credits"].items()})
        store.put("CREDITS#" + gid, {"credits": {k: v for k, v in cur.items() if v}})
    for pid in body.get("played") or []:
        it = items.pop(pid, None)
        if it:
            changed = True
            tg.send(it["chat"], TEXT["played"].format(w=e(it["word"].upper()), round=it.get("round", "")))
            events.log(gid, "word_played", tt=it["tt"], word=it["word"], round=it.get("round"))
    if "queue_ids" in body:                               # the game's real queue: what isn't there is done
        real = set(body["queue_ids"])                     # (played or lost, e.g. a report lost in a restart)
        for i in [i for i in items.values() if i["state"] == "queued" and i["id"] not in real]:
            del items[i["id"]]
            changed = True
            events.log(gid, "word_dropped", tt=i["tt"], word=i["word"], round=i.get("round"))
    words = []
    if (body.get("v") or 1) >= POLL_VERSION:
        for i in items.values():
            if i["state"] in ("new", "approved"):
                words.append({"id": i["id"], "word": i["word"], "tiktok_id": i["tt"], "name": i["name"],
                              "action": "check" if i["state"] == "new" else "queue"})
                i["state"] = "sent" if i["state"] == "new" else "queuing"
    cancel = [i["id"] for i in items.values() if i["state"] == "cancel"]
    for cid in cancel:
        del items[cid]                                    # the game drops it now
    if changed or words or cancel:
        store.put("PEND#" + gid, {"items": list(items.values())})
    return 200, {"words": words, "cancel": cancel}
