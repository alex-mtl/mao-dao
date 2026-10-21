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
import hmac
import json
import os
import time
from html import escape as html_escape

from . import events, riddle, store, texts, tg
from .words import pick_word, norm

KEY_TTL = 15 * 60
FLOW_TTL = 60 * 60
STREAM_TTL = 12 * 3600       # a stream the game forgot to stop expires by itself


KEY_PREFIX = "ключ-тг-"
# the command menu: viewers see MENU_ALL; hosts and superadmins get MENU_HOST in their own chat
MENU_ALL = [("start", "как связать аккаунт со стримом"), ("help", "помощь"),
            ("zagadka", "загадать слово для игры"), ("hints", "мои подсказки"),
            ("game", "переключиться на другой стрим")]
MENU_HOST = MENU_ALL + [("pick", "выбрать зрителя, который загадает слово"),
                        ("queue", "очередь загаданных слов")]


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
        store.put("HOSTOF#" + tg_id, {"game": h["game"]})
        tg.set_commands(MENU_HOST, chat)
        events.log(h["game"], "host", tg=tg_id, tg_name=user.get("username") or "")
        print(f"host of {h['game']}: tg {tg_id}")
        who = " ".join(filter(None, [user.get("first_name"), user.get("last_name"),
                                     "@" + user["username"] if user.get("username") else ""]))
        out = [(chat, t("owner_ok", word=(h.get("word") or h["game"]).upper()))]
        for a in (store.get("SUPERADMINS") or {}).get("chats", []):
            if a != chat:
                out.append((a, t("owner_new", game=h["game"], who=html_escape(who or tg_id), tg=tg_id)))
        return out
    if riddle.is_command(text):                                 # the host: "загадывает [nick]"
        return riddle.host_command(chat, tg_id, text)
    if riddle.is_hints_command(text):                           # anyone linked: "/hints", "подсказки"
        return riddle.hints_command(chat, tg_id)
    if riddle.is_queue_command(text):                           # the host: "/queue", "очередь"
        return riddle.queue_command(chat, tg_id)
    if riddle.is_viewer_command(text):                          # a viewer: "/zagadka", "загадка"
        store.delete("FLOW#" + tg_id)
        return riddle.viewer_command(chat, tg_id)
    if riddle.first_word(text) in GAME_COMMANDS:                # "/game WORD", "игра WORD": switch streams
        return switch_game(chat, tg_id, text, False, now)
    ask = store.get("ASK#" + tg_id)
    if ask and not text.startswith("/"):                       # the viewer answers the host's question
        return riddle.viewer_word(ask, chat, tg_id, text)
    if text.startswith("/start") or text.startswith("/help"):
        store.delete("FLOW#" + tg_id)
        tx = texts.TEXT[lang_of(DEFAULT_LANG)]
        host = text.startswith("/help") and (store.get("HOSTOF#" + tg_id)
                                             or chat in (store.get("SUPERADMINS") or {}).get("chats", []))
        extra = ("\n\n" + tx["help_all"] if text.startswith("/help") else "") + ("\n\n" + tx["help_host"] if host else "")
        return [(chat, tx["start"] + extra)]
    if flow["step"] == "switch":                                # the stream word after a bare "/game"
        return switch_game(chat, tg_id, text, True, now)
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


GAME_COMMANDS = ("game", "игра")


def switch_game(chat, tg_id, text, bare_word, now):
    """a linked viewer moves to another stream by its stream word; the TikTok link itself stays"""
    tx = texts.TEXT[lang_of(DEFAULT_LANG)]
    link = store.get("TG#" + tg_id)
    if not link:
        store.delete("FLOW#" + tg_id)
        return [(chat, riddle.TEXT["need_link"])]
    words = norm(text).split()
    word = (words[0] if bare_word else (words[1] if len(words) > 1 else "")) if words else ""
    if not word:
        store.put("FLOW#" + tg_id, {"step": "switch"}, ttl=now + FLOW_TTL)
        return [(chat, tx["ask_game"])]
    store.delete("FLOW#" + tg_id)
    stream = live_stream(word, now)
    if not stream:
        return [(chat, tx["no_stream"].format(word=html_escape(word)))]
    game = stream["game"]
    if link.get("game") != game:
        link["game"] = game
        store.put("TG#" + tg_id, link)
        store.put("TT#" + link["tiktok_id"], link)
        riddle.add_game_user(game, link)
        events.log(game, "switch", tt=link["tiktok_id"], tg=tg_id)
    return [(chat, tx["game_ok"].format(word=html_escape(word.upper())))]


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
        check_live_twin(game, game["tiktok"], now)
    store.put("GAME#" + game["pk_hash"], game)
    return 200, {"word": word, "bot": tg.bot_name()}


TWIN_WARN_EVERY = 30 * 60          # one "two games" warning per game per half hour
INST_WRITE_EVERY = 15              # a lone game refreshes its instance mark at most this often (seconds)


def warn_twins(games, text, now):
    """tell the hosts of these games and the superadmins (at most every TWIN_WARN_EVERY per game)"""
    if all(store.get("TWINWARN#" + g) for g in games):
        return
    for g in games:
        store.put("TWINWARN#" + g, {"at": int(now)}, ttl=now + TWIN_WARN_EVERY)
    chats = [o["chat"] for o in (store.get("OWNER#" + g) for g in games) if o]
    chats += (store.get("SUPERADMINS") or {}).get("chats", [])
    for chat in dict.fromkeys(chats):
        tg.send(chat, text)
    print(f"twins: {text}")


def check_live_twin(game, tiktok, now):
    """another game already runs this TikTok LIVE (e.g. a home game and a platform room)"""
    if not tiktok:
        return
    cur = store.get("LIVE#" + tiktok)
    if cur and cur.get("game") != game["id"] and cur.get("ttl", 0) > now:
        warn_twins([game["id"], cur["game"]], texts.TEXT["ru"]["twins_games"].format(
            tt=html_escape(tiktok), a=html_escape(cur["game"]), b=html_escape(game["id"])), now)
    store.put("LIVE#" + tiktok, {"game": game["id"]}, ttl=now + STREAM_TTL)


def check_instance_twin(game, instance, now):
    """the same game (same key) running twice: two instances poll with it. A restart is not a twin: the old
    instance never polls again after the new one's first poll."""
    if not instance:
        return
    gid = game["id"]
    seen = (store.get("INST#" + gid) or {}).get("seen", {})
    seen = {i: v for i, v in seen.items() if now - v["at"] < 120}
    others = {i: v for i, v in seen.items() if i != instance}
    if instance in seen and not others and now - seen[instance]["at"] < INST_WRITE_EVERY:
        return                                      # alone and recently marked: no write (1 write/s table)
    me = seen.setdefault(instance, {"first": now, "at": now})
    me["at"] = now
    if any(v["at"] > me["first"] and now - v["at"] < 30 for v in others.values()):
        warn_twins([gid], texts.TEXT["ru"]["twins_instances"].format(game=html_escape(gid)), now)
    store.put("INST#" + gid, {"seen": seen}, ttl=now + 3600)


def stream_stop(game, body):
    word = game.get("word")
    cur = store.get("WORD#" + word) if word else None
    if cur and cur.get("game") == game["id"]:
        store.delete("WORD#" + word)
    live = store.get("LIVE#" + game.get("tiktok", "")) if game.get("tiktok") else None
    if live and live.get("game") == game["id"]:
        store.delete("LIVE#" + game["tiktok"])
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
    riddle.add_game_user(game["id"], link)
    events.log(game["id"], "link", tt=who, name=link["tiktok_name"], tg=p["tg"], tg_name=p["tg_name"], first=first)
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
               "/game/key": game_key, "/game/push": game_push, "/game/host_code": host_code,
               "/game/poll": riddle.game_poll}


# ---------------------------------------------------------------- Lambda entry
def reply(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def new_game(gid, lang="ru"):
    """register a game (a room on the platform, or a home game) -> its key, shown once. A game id that
    already has a key gets a new one and the old key stops working (GAMEID#<id> remembers the current)."""
    key = base64.urlsafe_b64encode(os.urandom(24)).decode()
    h = hashlib.sha256(key.encode()).hexdigest()
    old = store.get("GAMEID#" + gid)
    if old and old.get("pk_hash") != h:
        store.delete("GAME#" + old["pk_hash"])
    store.put("GAME#" + h, {"id": gid, "pk_hash": h, "lang": lang})
    store.put("GAMEID#" + gid, {"pk_hash": h})
    return key


GAME_ID_RE = __import__("re").compile(r"^[a-z0-9][a-z0-9_-]{1,39}$")


def platform_games(body):
    """POST /platform/games {id, lang}: the platform (mao-dao) registers a room -> {id, game_key}.
    The key serves both this bot and the word-ranker Lambdas (they check the same table)."""
    gid = str(body.get("id") or "").lower()
    if not GAME_ID_RE.match(gid):
        return 400, {"error": "bad game id"}
    lang = body.get("lang") if body.get("lang") in ("ru", "en", "fr", "es") else "ru"
    return 200, {"id": gid, "game_key": new_game(gid, lang)}


def admin(event):
    """Direct invoke only (aws lambda invoke, needs IAM; the Function URL never gets here)."""
    action = event["action"]
    if action == "add_game":                         # {"action":"add_game","id":"mao","lang":"ru"}
        return {"id": event["id"], "game_key": new_game(event["id"], event.get("lang", "ru"))}
    if action == "set_superadmin":                   # {"action":"set_superadmin","username":"x"}: wrote to the bot before
        u = store.get("USER#" + event["username"].lstrip("@").lower())
        if not u:
            return {"error": "this username hasn't written to the bot"}
        admins = (store.get("SUPERADMINS") or {}).get("chats", [])
        if u["chat"] not in admins:
            store.put("SUPERADMINS", {"chats": admins + [u["chat"]]})
        tg.set_commands(MENU_HOST, u["chat"])
        tg.send(u["chat"], texts.TEXT["ru"]["superadmin"])
        return {"ok": True, "tg": u["tg"]}
    if action == "delete_later":                     # from tg.send_temp: an async invoke of this function
        time.sleep(min(int(event.get("delay", 60)), 600))
        tg.delete(event["chat"], event["mid"])
        return {"ok": True}
    if action == "set_menus":                        # {"action":"set_menus","games":["mao"]}: menus for all + hosts
        tg.set_commands(MENU_ALL)
        chats = set((store.get("SUPERADMINS") or {}).get("chats", []))
        chats |= {o["chat"] for o in (store.get("OWNER#" + g) for g in event.get("games", [])) if o}
        for c in chats:
            tg.set_commands(MENU_HOST, c)
        return {"ok": True, "host_menus": len(chats)}
    if action == "set_webhook":                      # {"action":"set_webhook","url":"https://...lambda-url.../tg"}
        return tg.call("setWebhook", url=event["url"], secret_token=tg.webhook_secret(),
                       allowed_updates=["message", "callback_query"], drop_pending_updates=True)
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
            for out in on_message(body["message"]):
                tg.send(*out)                                   # (chat, text) or (chat, text, buttons)
        elif body.get("callback_query"):
            riddle.on_callback(body["callback_query"])
        return reply(200, {"ok": True})
    if path == "/platform/games":                       # the platform's server, secret header
        try:
            secret = tg.param("platform-secret")
        except Exception:                              # not configured: the platform API is off
            secret = ""
        if not secret or not hmac.compare_digest(headers.get("x-platform-secret", ""), secret):
            return reply(403, {"error": "forbidden"})
        return reply(*platform_games(body))
    route = GAME_ROUTES.get(path)
    if route:
        game = game_by_key(headers)
        if not game:
            return reply(401, {"error": "bad game key"})
        return reply(*route(game, body))
    return reply(404, {"error": "not found"})
