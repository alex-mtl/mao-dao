""""загадывает": the host lets a linked viewer pick the secret word of a coming round.

  host:   "загадывает [part of a nick]" -> buttons with the game's linked viewers -> taps one
  viewer: gets a question, replies with one word (10 minutes)
  game:   polls /game/poll every ~10 s: takes new words, checks them in its dictionary, puts good ones in its
          queue and answers with the round number (or "not in the dictionary")
  bot:    tells the viewer and the host; the host sees the word with a "❌ отклонить" button

pk: HOSTOF#<tg id> -> game the user hosts; GAMEUSERS#<game> -> linked viewers; ASK#<tg id> -> open question;
PEND#<game> -> words on their way: state new (not yet given to the game) | sent | queued | cancel."""

import base64
import os
import time
from html import escape as e

from . import store, tg
from .words import norm

ASK_TTL = 10 * 60
MAX_BUTTONS = 12

TEXT = {
    "pick": "Кто загадывает слово? Выбери зрителя:",
    "pick_none": "Не нашёл зрителей{q}. Загадывать могут только зрители, связавшие аккаунт с ботом через твою игру.",
    "asked": "🎯 Спросил <b>{name}</b> (@{tt}), жду слово. Если не ответит за 10 минут — запрос отменится.",
    "ask": "🎯 Ведущий предлагает тебе загадать слово для игры на стриме!\n\nПришли одно слово "
           "(существительное, например <b>огурец</b>). Пока раунд с твоим словом идёт, твои догадки не принимаются.",
    "checking": "Проверяю слово «{w}»…",
    "busy": "Твоё прошлое слово ещё проверяется, подожди немного.",
    "queued": "✅ Слово «<b>{w}</b>» принято! Оно будет загадано в раунде <b>{round}</b>.",
    "host_queued": "🎯 <b>{name}</b> (@{tt}) загадал «<b>{w}</b>» — раунд <b>{round}</b>.",
    "missing": "Слова «{w}» нет в словаре игры. Пришли другое слово.",
    "host_missing": "📕 Слово «{w}» от <b>{name}</b> (@{tt}) не найдено в словаре.",
    "rejected": "Ведущий отклонил слово «{w}».",
    "host_rejected": "❌ Отклонено: «<b>{w}</b>» от <b>{name}</b>.",
    "too_late": "Это слово уже не отменить.",
    "played": "🎯 Твоё слово «<b>{w}</b>» загадано прямо сейчас в раунде {round}!",
    "not_host": "Эта команда только для ведущего игры.",
}


def is_command(text):
    return norm(text).startswith("загадывает")


def host_command(chat, tg_id, text):
    game = (store.get("HOSTOF#" + tg_id) or {}).get("game")
    if not game:
        return [(chat, TEXT["not_host"])]
    q = norm(text)[len("загадывает"):].strip().lstrip("@")
    users = (store.get("GAMEUSERS#" + game) or {}).get("users", {})
    found = [(tt, u) for tt, u in users.items()             # TikTok nick/name or messenger nick/name
             if not q or any(q in norm(x) for x in (tt, u.get("name"), u.get("tg_name"), u.get("tg_full")) if x)]
    found.sort(key=lambda x: -x[1].get("at", 0))
    if not found:
        return [(chat, TEXT["pick_none"].format(q=f" по «{e(q)}»" if q else ""))]
    rows = [[(f"{u.get('name') or tt} (@{tt})"[:48], "pick:" + tt)] for tt, u in found[:MAX_BUTTONS]]
    return [(chat, TEXT["pick"], tg.buttons(rows))]


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
    game = (store.get("HOSTOF#" + tg_id) or {}).get("game")
    tg.answer(cb.get("id"))
    if not game:
        return
    if data.startswith("pick:"):
        tt = data[5:]
        u = (store.get("GAMEUSERS#" + game) or {}).get("users", {}).get(tt)
        if not u:
            return
        store.put("ASK#" + u["tg"], {"game": game, "host": chat, "tt": tt, "name": u.get("name", "")}, ttl=now + ASK_TTL)
        tg.send(u["chat"], TEXT["ask"])
        tg.edit(chat, mid, TEXT["asked"].format(name=e(u.get("name") or tt), tt=e(tt)))
    elif data.startswith("rej:"):
        pend = store.get("PEND#" + game) or {"items": []}
        it = next((i for i in pend["items"] if i["id"] == data[4:]), None)
        if not it or it["state"] == "cancel":
            tg.edit(chat, mid, TEXT["too_late"])
            return
        it["state"] = "cancel"
        store.put("PEND#" + game, {"items": pend["items"]})
        tg.edit(chat, mid, TEXT["host_rejected"].format(w=e(it["word"].upper()), name=e(it["name"])))
        tg.send(it["chat"], TEXT["rejected"].format(w=e(it["word"])))


def viewer_word(ask, chat, tg_id, text, now=None):
    """the asked viewer sent their word -> waits for the game's dictionary check"""
    game = ask["game"]
    pend = store.get("PEND#" + game) or {"items": []}
    if any(i["tg"] == tg_id and i["state"] in ("new", "sent") for i in pend["items"]):
        return [(chat, TEXT["busy"])]
    word = text.strip().split()[0][:30]
    pend["items"].append({"id": base64.urlsafe_b64encode(os.urandom(6)).decode(), "word": word, "tt": ask["tt"],
                          "name": ask["name"], "tg": tg_id, "chat": chat, "host": ask["host"], "state": "new"})
    store.put("PEND#" + game, {"items": pend["items"]})
    return [(chat, TEXT["checking"].format(w=e(word)))]


def game_poll(game, body):
    """the game's results for words it got, then new words and cancellations for it"""
    gid = game["id"]
    pend = store.get("PEND#" + gid) or {"items": []}
    items = {i["id"]: i for i in pend["items"]}
    changed = False
    for r in body.get("results") or []:
        it = items.get(r.get("id"))
        if not it:
            continue
        changed = True
        if r.get("ok"):
            it.update(state="queued", word=r.get("word") or it["word"], round=r.get("round"))
            store.delete("ASK#" + it["tg"])
            w = e(it["word"].upper())
            tg.send(it["chat"], TEXT["queued"].format(w=w, round=it["round"]))
            tg.send(it["host"], TEXT["host_queued"].format(w=w, name=e(it["name"]), tt=e(it["tt"]), round=it["round"]),
                    tg.buttons([[("❌ отклонить", "rej:" + it["id"])]]))
        else:
            del items[it["id"]]
            tg.send(it["chat"], TEXT["missing"].format(w=e(it["word"])))
            tg.send(it["host"], TEXT["host_missing"].format(w=e(it["word"]), name=e(it["name"]), tt=e(it["tt"])))
    for pid in body.get("played") or []:
        it = items.pop(pid, None)
        if it:
            changed = True
            tg.send(it["chat"], TEXT["played"].format(w=e(it["word"].upper()), round=it.get("round", "")))
    words = [{"id": i["id"], "word": i["word"], "tiktok_id": i["tt"], "name": i["name"]}
             for i in items.values() if i["state"] == "new"]
    cancel = [i["id"] for i in items.values() if i["state"] == "cancel"]
    for i in list(items.values()):
        if i["state"] == "new":
            i["state"] = "sent"
        elif i["state"] == "cancel":
            del items[i["id"]]                  # the game removes it now
    if changed or words or cancel:
        store.put("PEND#" + gid, {"items": list(items.values())})
    return 200, {"words": words, "cancel": cancel}
