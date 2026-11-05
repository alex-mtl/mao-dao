"""tg-hub: a Telegram bot in the owner's project groups; Druzhok (another AI) reads what happens there and answers
through the bot. One AWS Lambda behind a Function URL; the API is described in ../API.md.

  POST /tg                       Telegram webhook (header X-Telegram-Bot-Api-Secret-Token)
  GET  /v1/events?since=&wait=   the feed: messages, edits, reactions, bot added / removed, ... (all chats)
  GET  /v1/chats                 chats the bot knows, with their projects
  POST /v1/chats/{chat_id}       {project: "doctorvet" | null}: bind a chat to a project
  GET  /v1/messages?chat=&limit=&before=&thread=   stored messages of a chat (chat id or project), oldest first
  GET  /v1/messages/{chat}/{message_id}
  POST /v1/send                  {chat, text, reply_to?, thread_id?, format?: "html" | "markdown"}
  POST /v1/react                 {chat, message_id, emoji | null}
  GET  /v1/file?file_id=         the file's bytes (up to FILE_MAX)

API callers send "Authorization: Bearer <token>"; the caller is found by sha256 of the token
(env TOKEN_SHA256_DRUZHOK / TOKEN_SHA256_CLAUDE). Owner's Telegram user ids: env OWNER_IDS (comma separated).

Table layout (store.py): pk META / sk COUNTER: event numbers ("seq"); pk EV / sk 000000000042: an event;
pk CHAT / sk <chat_id>: a chat; pk M#<chat_id> / sk 000000012345: a message (kept forever);
pk UPD / sk <update_id>: a processed webhook update (2 days); pk CURSOR / sk <who>; pk RATE / sk <who>#<minute>."""

import base64
import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime, timezone

from . import store, tg

DRUZHOK, CLAUDE = "druzhok", "claude"
TEXT_MAX = 4096                # one Telegram message
SEND_MAX = 40000               # a longer text is refused; up to this it is split into several messages
LIMIT_MAX = 200
RATE_PER_MIN = 300
WAIT_MAX = 20
WAIT_STEP = 2
POLL_SEC = 10                  # a poll every 10 s without wait: seconds of delay, fits the free tier
FILE_MAX = 4 * 1024 * 1024     # a Function URL answer is up to 6 MB, base64 adds a third
EVENT_KEEP_SEC = 90 * 86400    # the feed; the messages themselves are kept forever
UPDATE_KEEP_SEC = 2 * 86400
PROJECT_RE = r"[a-z0-9][a-z0-9_-]{0,39}"
ADDRESS_RE = re.compile(r"^\s*(дружок|druzhok)\b", re.I)
MEDIA = ("photo", "video", "document", "audio", "voice", "animation", "video_note", "sticker")
UPDATES = ["message", "edited_message", "channel_post", "edited_channel_post", "message_reaction",
           "message_reaction_count", "my_chat_member"]

now = time.time
sleep = time.sleep


class Fail(Exception):
    def __init__(self, status, code, message, headers=None):
        super().__init__(message)
        self.status, self.code, self.message, self.headers = status, code, message, headers or {}


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


def owners():
    return {int(x) for x in os.getenv("OWNER_IDS", "").replace(" ", "").split(",") if x.lstrip("-").isdigit()}


# ---------- Telegram objects -> stored form ----------

def person(u):
    if not u:
        return None
    name = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x)
    p = {"id": u["id"], "name": name or u.get("title", "")}
    if u.get("username"):
        p["username"] = u["username"]
    if u.get("is_bot"):
        p["is_bot"] = True
    if u.get("id") in owners():
        p["is_owner"] = True
    return p


def media_of(m):
    for kind in MEDIA:
        x = m.get(kind)
        if not x:
            continue
        if kind == "photo":
            x = max(x, key=lambda p: p.get("file_size") or p.get("width", 0) * p.get("height", 0))
        out = {"type": kind}
        for k in ("file_id", "file_unique_id", "file_name", "mime_type", "file_size", "width", "height", "duration",
                  "emoji"):
            if x.get(k) is not None:
                out[k] = x[k]
        return out
    return None


def links_of(m):
    text = m.get("text") or m.get("caption") or ""
    out = []
    for e in m.get("entities") or m.get("caption_entities") or []:
        if e.get("type") == "text_link":
            out.append(e["url"])
        elif e.get("type") == "url":
            out.append(text.encode("utf-16-le")[e["offset"] * 2:(e["offset"] + e["length"]) * 2].decode("utf-16-le"))
    return out


SERVICE = {
    "new_chat_members": lambda v: "joined: " + ", ".join(person(u)["name"] for u in v),
    "left_chat_member": lambda v: "left: " + person(v)["name"],
    "new_chat_title": lambda v: "new title: " + v,
    "new_chat_photo": lambda v: "new chat photo",
    "pinned_message": lambda v: f"pinned message {v.get('message_id')}",
    "migrate_to_chat_id": lambda v: f"the group became a supergroup, new chat id {v}",
    "forum_topic_created": lambda v: "topic created: " + v.get("name", ""),
}


def norm(m):
    """a Telegram message -> the stored form (one level: reply_to is a message id here)"""
    out = {"chat_id": m["chat"]["id"], "message_id": m["message_id"], "date": iso(m.get("date"))}
    if m.get("message_thread_id") and m.get("is_topic_message"):
        out["thread_id"] = m["message_thread_id"]
    sender = person(m.get("from")) or person(m.get("sender_chat"))
    if sender:
        out["from"] = sender
    text = m.get("text") or m.get("caption")
    if text:
        out["text"] = text
    media = media_of(m)
    if media:
        out["media"] = media
    for k in ("poll", "location", "contact"):
        if m.get(k):
            out[k] = m[k]
    links = links_of(m)
    if links:
        out["links"] = links
    if m.get("reply_to_message"):
        out["reply_to"] = m["reply_to_message"]["message_id"]
    if m.get("quote", {}).get("text"):
        out["quote"] = m["quote"]["text"]
    if m.get("external_reply"):
        ext = m["external_reply"]
        out["external_reply"] = {"chat": (ext.get("chat") or {}).get("title"), "message_id": ext.get("message_id")}
    fo = m.get("forward_origin")
    if fo:
        who = person(fo.get("sender_user")) or person(fo.get("chat") or fo.get("sender_chat"))
        out["forwarded"] = {"from": who["name"] if who else fo.get("sender_user_name", ""), "date": iso(fo.get("date"))}
    if m.get("edit_date"):
        out["edited_at"] = iso(m["edit_date"])
    if m.get("media_group_id"):
        out["album"] = m["media_group_id"]
    for k, f in SERVICE.items():
        if m.get(k):
            out["service"] = f(m[k])
    return out


def msg_key(chat_id):
    return f"M#{chat_id}"


def save_message(n):
    """store (or replace) a message, keeping what only we know (reactions)"""
    tb = store.table()
    old = tb.get(msg_key(n["chat_id"]), f"{n['message_id']:012d}")
    item = dict(n, pk=msg_key(n["chat_id"]), sk=f"{n['message_id']:012d}")
    if old:
        for k in ("reactions", "reaction_count"):
            if k in old:
                item[k] = old[k]
    tb.put(item)


def msg_view(item):
    return {k: v for k, v in item.items() if k not in ("pk", "sk")} if item else None


def addressed(m, n):
    """the message speaks to Druzhok: "Дружок, ..." at the start, @bot, a command or a reply to the bot"""
    text = n.get("text", "")
    if ADDRESS_RE.match(text) or text.startswith("/"):
        return True
    try:
        if "@" + tg.username().lower() in text.lower():
            return True
    except Exception:
        pass
    r = m.get("reply_to_message") or {}
    return bool(r.get("from", {}).get("is_bot") and r["from"]["id"] == tg.bot_id())


# ---------- chats ----------

def chat_item(chat_id):
    return store.table().get("CHAT", str(chat_id))


def chat_view(c):
    v = {k: c.get(k) for k in ("chat_id", "title", "type", "project", "bot_status", "is_forum", "added_by",
                               "migrated_to", "messages") if c.get(k) is not None}
    for k in ("added_at", "last_at"):
        if c.get(k):
            v[k] = iso(c[k])
    return v


def touch_chat(chat, fields=None):
    """create / refresh the chat record from a Telegram chat object"""
    t, tb = now(), store.table()
    c = chat_item(chat["id"]) or {"pk": "CHAT", "sk": str(chat["id"]), "chat_id": chat["id"], "added_at": int(t)}
    upd = {"title": chat.get("title") or person(chat)["name"], "type": chat.get("type")}
    if chat.get("is_forum"):
        upd["is_forum"] = True
    upd.update(fields or {})
    c.update(upd)
    tb.put(c)
    return c


def find_chat(ref):
    """a chat id or a project name -> the chat record (the live one if the group moved)"""
    ref = str(ref or "").strip()
    if not ref:
        raise Fail(400, "bad_request", "chat: a chat id or a project name")
    if re.fullmatch(r"-?\d+", ref):
        c = chat_item(ref)
    else:
        c = next((x for x in store.table().query("CHAT") if x.get("project") == ref.lower() and not x.get("migrated_to")),
                 None)
    if not c:
        raise Fail(404, "not_found", f"No chat {ref}")
    return c


# ---------- the feed ----------

def add_event(kind, chat=None, **data):
    t, tb = now(), store.table()
    seq = tb.add("META", "COUNTER", "seq")
    ev = {"pk": "EV", "sk": f"{seq:012d}", "seq": seq, "kind": kind, "at": int(t), "ttl": int(t + EVENT_KEEP_SEC)}
    if chat:
        ev["chat"] = {"id": chat["chat_id"], "title": chat.get("title")}
        if chat.get("project"):
            ev["chat"]["project"] = chat["project"]
    ev.update(data)
    tb.put(ev)
    return ev


def ev_view(ev):
    v = {k: x for k, x in ev.items() if k not in ("pk", "sk", "ttl", "at")}
    v["at"] = iso(ev["at"])
    return v


# ---------- webhook ----------

def on_message(m, edited=False):
    t = now()
    if m.get("migrate_to_chat_id"):                  # the group became a supergroup: a new chat id
        old = touch_chat(m["chat"], {"migrated_to": m["migrate_to_chat_id"], "bot_status": "migrated"})
        new = dict(m["chat"], id=m["migrate_to_chat_id"], type="supergroup")
        nc = touch_chat(new, {k: old[k] for k in ("project", "added_by", "bot_status") if old.get(k)} |
                        {"bot_status": (chat_item(new["id"]) or {}).get("bot_status") or "administrator",
                         "migrated_from": m["chat"]["id"]})
        add_event("chat_migrated", nc, old_chat_id=m["chat"]["id"])
        return
    if m.get("migrate_from_chat_id"):
        return
    n = norm(m)
    c = chat_item(m["chat"]["id"])
    c = touch_chat(m["chat"], {"last_at": int(t), "messages": (c or {}).get("messages", 0) + (0 if edited else 1)})
    r = m.get("reply_to_message")
    if r and r.get("chat", {}).get("id") == m["chat"]["id"]:
        rn = norm(r)                                 # an old message we may never have seen: keep it too
        tb = store.table()
        if not tb.get(msg_key(rn["chat_id"]), f"{rn['message_id']:012d}"):
            save_message(rn)
    save_message(n)
    if c.get("migrated_to"):
        return
    ev = {"message": n}
    if r:
        ev["reply_to_message"] = norm(r)
    if not edited and addressed(m, n):
        ev["addressed"] = True
    if not edited and n.get("from", {}).get("is_owner") and owner_command(c, n):
        return
    add_event("edit" if edited else "message", c, **ev)


def owner_command(c, n):
    """/project <name> in a group: bind it (the owner only). True = handled, not a feed event"""
    m = re.fullmatch(r"/project(?:@\w+)?(?:\s+(\S+))?\s*", n.get("text", ""))
    if not m:
        return False
    name = (m.group(1) or "").lower()
    if not name:
        reply = f"Проект этой группы: {c['project']}" if c.get("project") else "Группа не привязана к проекту. /project <имя>"
    elif name in ("-", "none", "off"):
        store.table().update("CHAT", str(c["chat_id"]), {"project": None})
        add_event("chat_project", dict(c, project=None), project=None, old=c.get("project"))
        reply = "Группа отвязана от проекта."
    elif not re.fullmatch(PROJECT_RE, name):
        reply = "Имя проекта: латиница, цифры, - и _ (до 40 символов)."
    else:
        bind(c, name)
        reply = f"Группа привязана к проекту {name}."
    send_text(c, reply, reply_to=n["message_id"])
    return True


def bind(c, project):
    for x in store.table().query("CHAT"):            # one live chat per project
        if x.get("project") == project and x["sk"] != str(c["chat_id"]) and not x.get("migrated_to"):
            raise Fail(409, "project_taken", f"Project {project} is bound to chat {x['chat_id']} ({x.get('title')})")
    store.table().update("CHAT", str(c["chat_id"]), {"project": project})
    add_event("chat_project", dict(c, project=project), project=project, old=c.get("project"))


def on_reaction(r):
    c = touch_chat(r["chat"])
    who = person(r.get("user")) or person(r.get("actor_chat"))
    emo = lambda lst: [x.get("emoji") or x.get("custom_emoji_id") or x.get("type") for x in lst or []]
    new, old = emo(r.get("new_reaction")), emo(r.get("old_reaction"))
    tb, sk = store.table(), f"{r['message_id']:012d}"
    item = tb.get(msg_key(c["chat_id"]), sk)
    if item and who:
        reactions = dict(item.get("reactions") or {})
        if new:
            reactions[str(who["id"])] = {"name": who["name"], "emoji": new}
        else:
            reactions.pop(str(who["id"]), None)
        tb.update(msg_key(c["chat_id"]), sk, {"reactions": reactions})
    add_event("reaction", c, message_id=r["message_id"], by=who, new=new, old=old,
              message_text=(item or {}).get("text", "")[:200] or None)


def on_reaction_count(r):
    c = touch_chat(r["chat"])
    counts = {(x["type"].get("emoji") or x["type"].get("type")): x["total_count"] for x in r.get("reactions", [])}
    tb, sk = store.table(), f"{r['message_id']:012d}"
    if tb.get(msg_key(c["chat_id"]), sk):
        tb.update(msg_key(c["chat_id"]), sk, {"reaction_count": counts})
    add_event("reaction_count", c, message_id=r["message_id"], counts=counts)


def on_member(u):
    """the bot itself was added / removed / promoted"""
    status = u["new_chat_member"]["status"]
    by = person(u.get("from"))
    fields = {"bot_status": status}
    old = chat_item(u["chat"]["id"])
    if status in ("member", "administrator") and (not old or old.get("bot_status") in (None, "left", "kicked")):
        fields.update(added_by=by, added_at=int(now()))
        kind = "bot_added"
    elif status in ("left", "kicked"):
        kind = "bot_removed"
    else:
        kind = "bot_status"
    c = touch_chat(u["chat"], fields)
    add_event(kind, c, by=by, status=status, old_status=u["old_chat_member"]["status"],
              known=bool(c.get("project")), by_owner=bool(by and by.get("is_owner")))


def on_update(upd):
    tb = store.table()
    uid = str(upd.get("update_id"))
    if tb.get("UPD", uid):
        return
    if upd.get("message") or upd.get("channel_post"):
        on_message(upd.get("message") or upd["channel_post"])
    elif upd.get("edited_message") or upd.get("edited_channel_post"):
        on_message(upd.get("edited_message") or upd["edited_channel_post"], edited=True)
    elif upd.get("message_reaction"):
        on_reaction(upd["message_reaction"])
    elif upd.get("message_reaction_count"):
        on_reaction_count(upd["message_reaction_count"])
    elif upd.get("my_chat_member"):
        on_member(upd["my_chat_member"])
    tb.put({"pk": "UPD", "sk": uid, "ttl": int(now() + UPDATE_KEEP_SEC)})


# ---------- API ----------

def _tokens():
    return {who: os.getenv("TOKEN_SHA256_" + who.upper(), "") for who in (DRUZHOK, CLAUDE)}


def who_is(headers):
    auth = headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise Fail(401, "unauthorized", "Bearer token required")
    digest = hashlib.sha256(auth[7:].strip().encode()).hexdigest()
    for who, h in _tokens().items():
        if h and hmac.compare_digest(digest, h):
            return who
    raise Fail(401, "unauthorized", "Unknown token")


def rate_limit(who):
    t = now()
    n = store.table().add("RATE", f"{who}#{int(t // 60)}", "n", 1, ttl=t + 120)
    if n > RATE_PER_MIN:
        raise Fail(429, "rate_limited", "Too many requests", {"Retry-After": str(60 - int(t) % 60)})


def _int(query, name, default, lo=0, hi=None):
    v = query.get(name)
    if v is None or v == "":
        return default
    if not re.fullmatch(r"-?\d+", v):
        raise Fail(400, "bad_request", f"{name}: an integer")
    v = int(v)
    if v < lo or (hi is not None and v > hi):
        raise Fail(400, "bad_request", f"{name}: {lo}..{hi}")
    return v


def events(who, since, wait, limit):
    tb = store.table()
    if since is None:
        cur = tb.get("CURSOR", who)
        since = cur["seq"] if cur else 0
    deadline = now() + wait
    while True:
        evs = tb.query("EV", f"{since:012d}", limit=limit + 1)
        if evs or now() >= deadline:
            break
        while now() < deadline:
            sleep(WAIT_STEP)
            if (tb.get("META", "COUNTER") or {}).get("seq", 0) > since:
                break
    more = len(evs) > limit
    evs = evs[:limit]
    last = evs[-1]["seq"] if evs else since
    tb.put({"pk": "CURSOR", "sk": who, "seq": last})
    return {"events": [ev_view(e) for e in evs], "last_seq": last, "has_more": more,
            "next_poll_sec": 0 if more else POLL_SEC}


def messages(query):
    c = find_chat(query.get("chat"))
    limit = _int(query, "limit", 20, 1, LIMIT_MAX)
    before = _int(query, "before", None, 1)
    thread = _int(query, "thread", None, 1)
    tb, out, cursor = store.table(), [], f"{before:012d}" if before else None
    while len(out) < limit:                          # newest first, then turned over
        batch = tb.query(msg_key(c["chat_id"]), before=cursor, limit=limit if thread is None else LIMIT_MAX, desc=True)
        if not batch:
            break
        out += [m for m in batch if thread is None or m.get("thread_id") == thread]
        cursor = batch[-1]["sk"]
    out = out[:limit][::-1]
    return {"chat": chat_view(c), "messages": [msg_view(m) for m in out]}


def one_message(chat, mid):
    c = find_chat(chat)
    m = store.table().get(msg_key(c["chat_id"]), f"{int(mid):012d}")
    if not m:
        raise Fail(404, "not_found", f"No stored message {mid} in {chat}")
    return {"chat": chat_view(c), "message": msg_view(m)}


def split_text(text):
    parts = []
    while len(text) > TEXT_MAX:
        cut = max(text.rfind("\n", 0, TEXT_MAX), text.rfind(" ", 0, TEXT_MAX))
        cut = cut if cut > TEXT_MAX // 2 else TEXT_MAX
        parts.append(text[:cut])
        text = text[cut:].lstrip("\n ")
    return parts + ([text] if text else [])


def send_text(c, text, reply_to=None, thread_id=None, fmt=None, by=None):
    out = []
    for i, part in enumerate(split_text(text)):
        data = {"chat_id": c["chat_id"], "text": part, "link_preview_options": {"is_disabled": True}}
        if fmt:
            data["parse_mode"] = {"html": "HTML", "markdown": "MarkdownV2"}[fmt]
        if reply_to and i == 0:
            data["reply_parameters"] = {"message_id": reply_to, "allow_sending_without_reply": True}
        if thread_id:
            data["message_thread_id"] = thread_id
        try:
            m = tg.call("sendMessage", **data)
        except tg.TgError as e:
            raise Fail(502, "telegram_error", f"Telegram: {e.description}")
        n = norm(m)
        if by:
            n["sent_by"] = by
        save_message(n)
        out.append(n)
    return out


def send(who, body):
    c = find_chat(body.get("chat"))
    if c.get("bot_status") in ("left", "kicked", "migrated"):
        raise Fail(409, "not_in_chat", f"The bot is not in {c.get('title')} ({c['bot_status']})")
    text = body.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > SEND_MAX:
        raise Fail(400, "bad_request", f"text: 1..{SEND_MAX} characters")
    fmt = body.get("format")
    if fmt not in (None, "html", "markdown"):
        raise Fail(400, "bad_request", "format: html | markdown | null")
    for k in ("reply_to", "thread_id"):
        if body.get(k) is not None and (not isinstance(body[k], int) or isinstance(body[k], bool)):
            raise Fail(400, "bad_request", f"{k}: an integer")
    sent = send_text(c, text, body.get("reply_to"), body.get("thread_id"), fmt, by=who)
    return {"chat": chat_view(c), "messages": sent}


def react(body):
    c = find_chat(body.get("chat"))
    mid, emoji = body.get("message_id"), body.get("emoji")
    if not isinstance(mid, int) or isinstance(mid, bool):
        raise Fail(400, "bad_request", "message_id: an integer")
    if emoji is not None and not (isinstance(emoji, str) and 0 < len(emoji) <= 10):
        raise Fail(400, "bad_request", "emoji: one emoji or null")
    try:
        tg.call("setMessageReaction", chat_id=c["chat_id"], message_id=mid,
                reaction=[{"type": "emoji", "emoji": emoji}] if emoji else [])
    except tg.TgError as e:
        raise Fail(502, "telegram_error", f"Telegram: {e.description}")
    return {"ok": True}


def get_file(query):
    fid = query.get("file_id") or ""
    if not re.fullmatch(r"[\w-]{10,300}", fid):
        raise Fail(400, "bad_request", "file_id required")
    try:
        f = tg.call("getFile", file_id=fid)
    except tg.TgError as e:
        raise Fail(413 if "too big" in e.description else 404, "telegram_error", f"Telegram: {e.description}")
    if (f.get("file_size") or 0) > FILE_MAX:
        raise Fail(413, "file_too_big", f"{f['file_size']} bytes, the API gives files up to {FILE_MAX}")
    data = tg.download(f["file_path"])
    if len(data) > FILE_MAX:
        raise Fail(413, "file_too_big", f"{len(data)} bytes, the API gives files up to {FILE_MAX}")
    return data, f["file_path"]


def set_project(chat_id, body):
    c = find_chat(chat_id)
    if "project" not in body:
        raise Fail(400, "bad_request", "project: a name or null")
    p = body["project"]
    if p is None:
        store.table().update("CHAT", str(c["chat_id"]), {"project": None})
        add_event("chat_project", dict(c, project=None), project=None, old=c.get("project"))
    elif isinstance(p, str) and re.fullmatch(PROJECT_RE, p):
        bind(c, p)
    else:
        raise Fail(400, "bad_request", "project: latin letters, digits, - and _, up to 40")
    return {"chat": chat_view(find_chat(c["chat_id"]))}


def route(method, path, query, body, who):
    if path == "/v1/events" and method == "GET":
        since = _int(query, "since", None)
        return 200, events(who, since, _int(query, "wait", 0, 0, WAIT_MAX), _int(query, "limit", 100, 1, LIMIT_MAX))
    if path == "/v1/chats" and method == "GET":
        chats = sorted(store.table().query("CHAT"), key=lambda c: (c.get("project") is None, c.get("title") or ""))
        return 200, {"chats": [chat_view(c) for c in chats]}
    m = re.fullmatch(r"/v1/chats/(-?\d+)", path)
    if m and method == "POST":
        return 200, set_project(m.group(1), body)
    if path == "/v1/messages" and method == "GET":
        return 200, messages(query)
    m = re.fullmatch(r"/v1/messages/([^/]+)/(\d+)", path)
    if m and method == "GET":
        return 200, one_message(m.group(1), m.group(2))
    if path == "/v1/send" and method == "POST":
        return 201, send(who, body)
    if path == "/v1/react" and method == "POST":
        return 200, react(body)
    raise Fail(404, "not_found", f"No route {method} {path}")


# ---------- HTTP ----------

def _json(status, data, headers=None):
    return {"statusCode": status, "headers": dict({"Content-Type": "application/json; charset=utf-8"}, **(headers or {})),
            "body": json.dumps(data, ensure_ascii=False)}


def admin(event):
    """direct `aws lambda invoke` only: {"action": "set_webhook", "url": ".../tg"} | {"action": "set_commands"}"""
    if event["action"] == "set_webhook":
        return tg.call("setWebhook", url=event["url"], secret_token=tg.param("webhook-secret"),
                       allowed_updates=UPDATES, drop_pending_updates=False)
    if event["action"] == "set_commands":
        for scope in ({"type": "all_group_chats"}, {"type": "default"}):
            tg.call("setMyCommands", scope=scope, commands=[
                {"command": "project", "description": "привязать группу к проекту: /project doctorvet"}])
        return {"ok": True, "username": tg.username()}
    if event["action"] == "info":
        return {"webhook": tg.call("getWebhookInfo"), "me": tg.call("getMe")}
    return {"error": "unknown action"}


def handler(event, context=None):
    if "action" in event and "rawPath" not in event:
        return admin(event)
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = (event.get("rawPath") or "/").rstrip("/") or "/"
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    if path == "/tg":
        if not hmac.compare_digest(headers.get("x-telegram-bot-api-secret-token", ""), tg.param("webhook-secret")):
            return _json(403, {"error": "forbidden"})
        try:
            upd = json.loads(raw)
        except ValueError:
            return _json(200, {"ok": False})
        try:
            on_update(upd)
        except Fail as e:                            # e.g. /project with a taken name: tell the group, don't retry
            chat = (upd.get("message") or {}).get("chat")
            if chat:
                try:
                    send_text({"chat_id": chat["id"]}, e.message)
                except Exception:
                    pass
            store.table().put({"pk": "UPD", "sk": str(upd.get("update_id")), "ttl": int(now() + UPDATE_KEEP_SEC)})
        return _json(200, {"ok": True})              # other errors: Lambda fails, Telegram repeats the update
    try:
        who = who_is(headers)
        rate_limit(who)
        if path == "/v1/file" and method == "GET":
            data, fpath = get_file(event.get("queryStringParameters") or {})
            name = fpath.rsplit("/", 1)[-1]
            return {"statusCode": 200, "isBase64Encoded": True, "body": base64.b64encode(data).decode(),
                    "headers": {"Content-Type": "application/octet-stream",
                                "Content-Disposition": f'attachment; filename="{name}"'}}
        try:
            body = json.loads(raw) if raw.strip() else {}
        except ValueError:
            raise Fail(400, "bad_request", "Body is not JSON")
        if not isinstance(body, dict):
            raise Fail(400, "bad_request", "Body must be a JSON object")
        status, data = route(method, path, event.get("queryStringParameters") or {}, body, who)
        return _json(status, data)
    except Fail as e:
        return _json(e.status, {"error": {"code": e.code, "message": e.message}}, e.headers)
