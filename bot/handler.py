"""tiktok-tg-bot: one AWS Lambda behind a Function URL.

Routes
  POST /tg                 Telegram webhook (header X-Telegram-Bot-Api-Secret-Token must match)
  POST /game/stream/start  game -> {tiktok}            <- {word, bot}   stream word, unique among live streams
  POST /game/stream/stop   game -> {}                  <- {ok}
  POST /game/key           game -> {key, tiktok_id, tiktok_name} <- {ok, linked, first, reason}
  POST /game/push          game -> {tiktok_id, text}   <- {ok, sent}  message to a linked viewer
Game requests carry "Authorization: Bearer <game key>"; the game is found by sha256(key).

The viewer's cycle (see README): stream word on screen -> bot: word + TikTok nick -> key "ключ-тг-XXXXXXXX"
-> key in the stream chat -> the game calls /game/key with the author's TikTok id -> linked."""

import base64
import hashlib
import json
import os
import time
from html import escape as html_escape

from . import store, texts, tg
from .words import pick_word, norm

KEY_TTL = 15 * 60
FLOW_TTL = 60 * 60
STREAM_TTL = 12 * 3600       # a stream the game forgot to stop expires by itself


KEY_PREFIX = "ключ-тг-"


def new_key():
    return KEY_PREFIX + base64.urlsafe_b64encode(os.urandom(6)).decode()


def parse_tiktok(text):
    import re
    text = (text or "").strip()
    m = re.search(r"tiktok\.com/@([A-Za-z0-9_.]{2,30})", text, re.I) or re.match(r"^@?([A-Za-z0-9_.]{2,30})$", text)
    return m.group(1).lower() if m else None


DEFAULT_LANG = os.getenv("DEFAULT_LANG", "ru")   # until the stream is known; then the game's language


def lang_of(game_lang):
    return game_lang if game_lang in texts.TEXT else "en"


# ---------------------------------------------------------------- telegram dialog
def on_message(msg, now=None):
    """Incoming Telegram message -> list of (chat_id, text)."""
    now = now or time.time()
    chat = (msg.get("chat") or {}).get("id")
    user = msg.get("from") or {}
    tg_id = str(user.get("id", chat))
    flow = store.get("FLOW#" + tg_id) or {"step": "word"}
    lang = lang_of(flow.get("lang", DEFAULT_LANG))
    text = (msg.get("text") or "").strip()
    if not chat or not text:
        return []
    t = lambda k, **kw: texts.TEXT[lang][k].format(**kw)
    remember_user(user, chat)
    if text.startswith("/start host_"):                         # the streamer opened the link from their game's menu
        code = text[len("/start host_"):].strip()
        h = store.get("HOSTCODE#" + code) if code else None
        if not h:
            return [(chat, t("owner_bad"))]
        store.delete("HOSTCODE#" + code)
        store.put("OWNER#" + h["game"], {"chat": chat, "tg": tg_id})
        print(f"host of {h['game']}: tg {tg_id}")
        who = " ".join(filter(None, [user.get("first_name"), user.get("last_name"),
                                     "@" + user["username"] if user.get("username") else ""]))
        out = [(chat, t("owner_ok", word=(h.get("word") or h["game"]).upper()))]
        for a in (store.get("SUPERADMINS") or {}).get("chats", []):
            if a != chat:
                out.append((a, t("owner_new", game=h["game"], who=html_escape(who or tg_id), tg=tg_id)))
        return out
    if text.startswith("/start") or text.startswith("/help"):
        store.delete("FLOW#" + tg_id)
        return [(chat, texts.TEXT[lang_of(DEFAULT_LANG)]["start"])]
    if flow["step"] == "word":
        word, _, rest = text.partition(" ")                     # "маринад @nick" in one message works too
        stream = live_stream(norm(word), now)
        if not stream:
            return [(chat, t("no_stream", word=word))]
        lang = lang_of(stream.get("lang", DEFAULT_LANG))
        flow = {"step": "nick", "word": norm(word), "game": stream["game"], "lang": lang}
        store.put("FLOW#" + tg_id, flow, ttl=now + FLOW_TTL)
        if not rest.strip():
            return [(chat, t("ask_nick"))]
        text = rest.strip()
    tt = parse_tiktok(text)
    if not tt:
        return [(chat, t("bad_nick"))]
    stream = live_stream(flow["word"], now)
    if not stream or stream["game"] != flow["game"]:           # the stream ended meanwhile
        store.delete("FLOW#" + tg_id)
        return [(chat, t("no_stream", word=flow["word"]))]
    key = new_key()
    store.put("KEY#" + key[len(KEY_PREFIX):], {"tg": tg_id, "chat": chat, "tiktok_id": tt, "game": flow["game"],
                                            "lang": lang, "tg_name": user.get("username") or "",
                                            "tg_full": " ".join(filter(None, [user.get("first_name"), user.get("last_name")]))},
              ttl=now + KEY_TTL)
    store.delete("FLOW#" + tg_id)
    return [(chat, t("key", tt=tt, key=key))]


def remember_user(user, chat):
    """@username -> Telegram id, so the bot's owner can be made superadmin by username (admin invoke)."""
    name = (user.get("username") or "").lower()
    if name:
        rec = {"tg": str(user.get("id", chat)), "chat": chat}
        cur = store.get("USER#" + name)
        if not cur or cur.get("tg") != rec["tg"] or cur.get("chat") != chat:
            store.put("USER#" + name, rec)


def live_stream(word, now):
    s = store.get("WORD#" + word) if word else None
    return s if s and s.get("ttl", 0) > now else None


# ---------------------------------------------------------------- game API
def game_by_key(headers):
    auth = headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    return store.get("GAME#" + hashlib.sha256(auth[7:].strip().encode()).hexdigest())


def stream_start(game, body, now=None):
    now = now or time.time()
    gid = game["id"]
    word = game.get("word")
    cur = store.get("WORD#" + word) if word else None
    if not (cur and cur.get("game") == gid and cur.get("ttl", 0) > now):   # restart mid-stream keeps the word
        word = None
        for _ in range(20):
            w = pick_word(game.get("lang", "ru"))
            if store.claim("WORD#" + w, {"game": gid, "lang": game.get("lang", "ru")}, ttl=now + STREAM_TTL, now=now):
                word = w
                break
        if not word:
            return 503, {"error": "no free word"}
    else:
        store.put("WORD#" + word, {"game": gid, "lang": game.get("lang", "ru")}, ttl=now + STREAM_TTL)
    game["word"] = word
    if body.get("tiktok"):
        game["tiktok"] = body["tiktok"].lstrip("@").lower()
    store.put("GAME#" + game["pk_hash"], game)
    return 200, {"word": word, "bot": tg.bot_name()}


def stream_stop(game, body):
    word = game.get("word")
    cur = store.get("WORD#" + word) if word else None
    if cur and cur.get("game") == game["id"]:
        store.delete("WORD#" + word)
    return 200, {"ok": True}


def game_key(game, body, now=None):
    """The game saw a key in its chat. Returns what to show; sends the Telegram reply itself."""
    now = now or time.time()
    import re
    m = re.search(r"ключ-тг-([A-Za-z0-9_-]{8})", body.get("key", ""), re.I)
    p = store.get("KEY#" + m.group(1)) if m else None
    if not p or p.get("ttl", 0) <= now or p["game"] != game["id"]:
        return 200, {"ok": False, "reason": "unknown"}
    who = (body.get("tiktok_id") or "").lower()
    t = lambda k, **kw: texts.TEXT[p["lang"]][k].format(**kw)
    if who != p["tiktok_id"]:
        tg.send(p["chat"], t("wrong", who=who, tt=p["tiktok_id"]))
        return 200, {"ok": False, "reason": "other_account"}
    store.delete("KEY#" + m.group(1))
    first = store.get("TT#" + who) is None
    link = {"tg": p["tg"], "chat": p["chat"], "tiktok_id": who, "tiktok_name": body.get("tiktok_name", ""),
            "tg_name": p["tg_name"], "tg_full": p.get("tg_full", ""), "game": game["id"], "at": int(now)}
    store.put("TT#" + who, link)
    store.put("TG#" + p["tg"], link)
    tg.send(p["chat"], t("done", tt=who))
    owner = store.get("OWNER#" + game["id"])                    # the streamer: links in their game
    admins = (store.get("SUPERADMINS") or {}).get("chats", [])  # the bot's owner: links in every game
    for chat in dict.fromkeys(([owner["chat"]] if owner else []) + admins):
        tg.send(chat, owner_note(link, first))
    print(f"linked tg {p['tg']} <-> @{who} via {game['id']}")
    return 200, {"ok": True, "linked": True, "first": first}


def owner_note(link, first):
    from html import escape as e
    tgn = " ".join(filter(None, [e(link.get("tg_full", "")), "@" + e(link["tg_name"]) if link["tg_name"] else ""]))
    return (f"📲 {'Новая привязка' if first else 'Повторная привязка'} · {e(link['game'])}\n"
            f"TikTok: <b>@{e(link['tiktok_id'])}</b> ({e(link['tiktok_name'])})\n"
            f"Telegram: <a href=\"tg://user?id={link['tg']}\">{tgn or link['tg']}</a>")


def game_push(game, body):
    link = store.get("TT#" + (body.get("tiktok_id") or "").lower())
    if not link or not body.get("text"):
        return 200, {"ok": True, "sent": False}
    tg.send(link["chat"], str(body["text"])[:3500])
    return 200, {"ok": True, "sent": True}


HOST_CODE_TTL = 10 * 60


def host_code(game, body, now=None):
    """One-time link for the game's menu: whoever opens it in the messenger becomes the game's host (owner).
    Proof of being the host = access to the game itself (only it has the game key)."""
    now = now or time.time()
    code = base64.urlsafe_b64encode(os.urandom(6)).decode()
    store.put("HOSTCODE#" + code, {"game": game["id"], "word": game.get("word", "")}, ttl=now + HOST_CODE_TTL)
    return 200, {"link": f"https://t.me/{tg.bot_name()}?start=host_{code}", "ttl": HOST_CODE_TTL}


GAME_ROUTES = {"/game/stream/start": stream_start, "/game/stream/stop": stream_stop,
               "/game/key": game_key, "/game/push": game_push, "/game/host_code": host_code}


# ---------------------------------------------------------------- Lambda entry
def reply(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def admin(event):
    """Direct invoke only (aws lambda invoke, needs IAM; the Function URL never gets here)."""
    action = event["action"]
    if action == "add_game":                         # {"action":"add_game","id":"mao","lang":"ru"}
        key = base64.urlsafe_b64encode(os.urandom(24)).decode()
        h = hashlib.sha256(key.encode()).hexdigest()
        store.put("GAME#" + h, {"id": event["id"], "pk_hash": h, "lang": event.get("lang", "ru")})
        return {"id": event["id"], "game_key": key}  # shown once, goes to the game's .env
    if action == "set_superadmin":                   # {"action":"set_superadmin","username":"x"}: wrote to the bot before
        u = store.get("USER#" + event["username"].lstrip("@").lower())
        if not u:
            return {"error": "this username hasn't written to the bot"}
        admins = (store.get("SUPERADMINS") or {}).get("chats", [])
        if u["chat"] not in admins:
            store.put("SUPERADMINS", {"chats": admins + [u["chat"]]})
        tg.send(u["chat"], texts.TEXT["ru"]["superadmin"])
        return {"ok": True, "tg": u["tg"]}
    if action == "set_webhook":                      # {"action":"set_webhook","url":"https://...lambda-url.../tg"}
        return tg.call("setWebhook", url=event["url"], secret_token=tg.webhook_secret(),
                       allowed_updates=["message"], drop_pending_updates=True)
    return {"error": "unknown action"}


def lambda_handler(event, context):
    if "action" in event and "rawPath" not in event:
        return admin(event)
    path = event.get("rawPath", "/")
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    try:
        body = json.loads(raw) if raw else {}
    except ValueError:
        return reply(400, {"error": "bad json"})
    if path == "/tg":
        if headers.get("x-telegram-bot-api-secret-token") != tg.webhook_secret():
            return reply(403, {"error": "forbidden"})
        if body.get("message"):
            for chat, text in on_message(body["message"]):
                tg.send(chat, text)
        return reply(200, {"ok": True})
    route = GAME_ROUTES.get(path)
    if route:
        game = game_by_key(headers)
        if not game:
            return reply(401, {"error": "bad game key"})
        return reply(*route(game, body))
    return reply(404, {"error": "not found"})
