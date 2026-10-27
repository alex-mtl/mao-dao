"""ai-mailbox: tasks between Claude and Druzhok (another AI). One AWS Lambda behind a Function URL.
The API is described in ../API.md; every request carries "Authorization: Bearer <token>", the sender is found by
sha256 of the token (env TOKEN_SHA256_CLAUDE / TOKEN_SHA256_DRUZHOK).

Routes (all under /v1)
  GET  /inbox?since=&wait=   new messages from the other side + open tasks, mode, next_poll_sec
  POST /ping                 druzhok: {tasks: [{id, phase?, percent?}]} -> same answer as /inbox
  GET  /tasks?status=        open | closed | all
  GET  /tasks/{id}           a task with all its messages
  POST /tasks                claude: {title, body} -> a new task T-0001...
  POST /tasks/{id}/messages  {kind, text, phase?, percent?, files?, client_id?}
  GET  /stats?days=          claude: per-task numbers and totals"""

import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime, timezone

from . import store

CLAUDE, DRUZHOK = "claude", "druzhok"
OTHER = {CLAUDE: DRUZHOK, DRUZHOK: CLAUDE}
KINDS = {CLAUDE: {"answer", "instruction", "thanks", "cancel"},
         DRUZHOK: {"ack", "progress", "question", "result"}}
OPEN = ("new", "in_progress", "waiting", "review")

TEXT_MAX = 256 * 1024
TITLE_MAX = 200
PHASE_MAX = 200
FILES_MAX = 50
RATE_PER_MIN = 120
WAIT_MAX = 25                 # long poll, seconds (Lambda timeout is 30 s)
WAIT_STEP = 2                 # how often a long poll looks at the counter
IDLE_POLL, ACTIVE_POLL = 600, 60
STALLED_SEC = 180             # no ping / message from druzhok this long in active work = stalled
SLOW_WAITING_SEC = 30 * 60    # every open task waits for claude's answer this long -> druzhok may poll every 10 min
GAP_DEAD_SEC = 30             # a missing message number older than this is a lost write, not one in flight
TASK_KEEP_SEC = 7 * 86400     # a closed task is kept this long
MSG_KEEP_SEC = 14 * 86400

now = time.time               # tests replace these two
sleep = time.sleep


class Fail(Exception):
    def __init__(self, status, code, message, headers=None):
        super().__init__(message)
        self.status, self.code, self.message, self.headers = status, code, message, headers or {}


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


def _tokens():
    return {who: os.getenv("TOKEN_SHA256_" + who.upper(), "") for who in (CLAUDE, DRUZHOK)}


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
    minute = int(t // 60)
    n = store.table().add("RATE", f"{who}#{minute}", "n", 1, ttl=t + 120)
    if n > RATE_PER_MIN:
        raise Fail(429, "rate_limited", "Too many requests", {"Retry-After": str(60 - int(t) % 60)})


# ---------- tasks and messages ----------

def get_task(task_id):
    task = store.table().get("TASK", task_id) if re.fullmatch(r"T-\d{4,}", task_id or "") else None
    if not task:
        raise Fail(404, "not_found", f"No task {task_id}")
    return task


def all_tasks():
    t = now()
    return [x for x in store.table().query("TASK") if not x.get("ttl") or x["ttl"] > t]


def last_seen(task):
    return max(task.get("last_ping_at") or 0, task.get("last_druzhok_at") or 0, task.get("seen_at") or 0)


def is_stalled(task, t):
    if task["status"] not in ("in_progress", "review", "waiting"):
        return False
    if task["status"] == "waiting" and t - task.get("waiting_since", t) > SLOW_WAITING_SEC:
        return False
    return t - last_seen(task) > STALLED_SEC


def task_view(task, who, t):
    v = {"id": task["sk"], "title": task["title"], "status": task["status"]}
    if who == CLAUDE or task["status"] != "new":
        v.update(phase=task.get("phase"), percent=task.get("percent"), created_at=iso(task["created_at"]),
                 updated_at=iso(task.get("updated_at")), last_ping_at=iso(task.get("last_ping_at")))
    if who == CLAUDE:
        v["stalled"] = is_stalled(task, t)
    return v


def msg_view(m):
    v = {k: m.get(k) for k in ("seq", "task_id", "from", "kind", "text", "phase", "percent", "files")
         if m.get(k) is not None}
    v["created_at"] = iso(m["created_at"])
    return v


def add_message(task, who, kind, text, phase=None, percent=None, files=None, client_id=None):
    t, tb = now(), store.table()
    if client_id:
        old = tb.get("CLIENT", f"{who}#{client_id}")
        if old:
            m = tb.get("MSG", f"{old['seq']:012d}")
            return m, get_task(m["task_id"]) if m else task
    seq = tb.add("META", "COUNTER", "seq")
    m = {"pk": "MSG", "sk": f"{seq:012d}", "seq": seq, "task_id": task["sk"], "from": who, "kind": kind,
         "text": text, "created_at": int(t), "ttl": int(t + MSG_KEEP_SEC)}
    if phase is not None:
        m["phase"] = phase
    if percent is not None:
        m["percent"] = percent
    if files:
        m["files"] = files
    tb.put(m)
    if client_id:
        tb.put({"pk": "CLIENT", "sk": f"{who}#{client_id}", "seq": seq, "ttl": int(t + 86400)})

    st, upd = task["status"], {"updated_at": int(t)}
    nbytes = len(text.encode())
    upd[f"msgs_{who}"] = task.get(f"msgs_{who}", 0) + 1
    upd[f"bytes_{who}"] = task.get(f"bytes_{who}", 0) + nbytes
    if files:
        upd["files"] = task.get("files", 0) + len(files)
        upd["file_bytes"] = task.get("file_bytes", 0) + sum(f["size"] for f in files)
    if who == DRUZHOK:
        upd["last_druzhok_at"] = int(t)
        upd.update(_stall_count(task, t))
        if kind in ("ack", "progress") and st == "new":
            st = "in_progress"
        if kind == "ack" and not task.get("acked_at"):
            upd["acked_at"] = int(t)
        if kind == "question":
            st, upd["waiting_since"] = "waiting", int(t)
        if kind == "result":
            st = "review"
            upd.setdefault("result_at", task.get("result_at") or int(t))
    else:
        if kind in ("answer", "instruction") and st in ("waiting", "review"):
            st = "in_progress"
        if kind in ("thanks", "cancel"):
            st = "closed" if kind == "thanks" else "cancelled"
            upd["closed_at"], upd["ttl"] = int(t), int(t + TASK_KEEP_SEC)
    if phase is not None:
        upd["phase"] = phase
    if percent is not None:
        upd["percent"] = percent
    upd["status"] = st
    tb.update("TASK", task["sk"], upd)
    task = dict(task, **upd)
    return m, task


def _stall_count(task, t):
    """druzhok shows up after a stall: count the episode once"""
    if task["status"] != "new" and is_stalled(task, t):
        return {"stalled_count": task.get("stalled_count", 0) + 1}
    return {}


def create_task(body):
    title = (body.get("title") or "").strip()
    text = body.get("body") or ""
    if not title or len(title) > TITLE_MAX:
        raise Fail(400, "bad_request", f"title: 1..{TITLE_MAX} characters")
    _check_text(text)
    t, tb = now(), store.table()
    n = tb.add("META", "COUNTER", "task_n")
    task = {"pk": "TASK", "sk": f"T-{n:04d}", "title": title, "status": "new", "created_at": int(t),
            "updated_at": int(t)}
    tb.put(task)
    m, task = add_message(task, CLAUDE, "task", text)
    return task, m


def _check_text(text):
    if not isinstance(text, str):
        raise Fail(400, "bad_request", "text must be a string")
    if len(text.encode()) > TEXT_MAX:
        raise Fail(400, "bad_request", f"text over {TEXT_MAX} bytes: send a file")


def _check_progress(phase, percent):
    if phase is not None and (not isinstance(phase, str) or len(phase) > PHASE_MAX):
        raise Fail(400, "bad_request", f"phase: a string up to {PHASE_MAX} characters")
    if percent is not None and (not isinstance(percent, int) or isinstance(percent, bool) or not 0 <= percent <= 100):
        raise Fail(400, "bad_request", "percent: an integer 0..100")


def _check_files(files, task_id, who):
    if files is None:
        return None
    if not isinstance(files, list) or len(files) > FILES_MAX:
        raise Fail(400, "bad_request", f"files: a list of up to {FILES_MAX}")
    out = []
    for f in files:
        path = f.get("path") if isinstance(f, dict) else None
        if not isinstance(path, str) or not path.startswith(f"{task_id}/{who}/") or ".." in path.split("/") \
                or not re.fullmatch(r"[\w.\-/ ]{1,300}", path):
            raise Fail(400, "bad_request", f"files: path must be {task_id}/{who}/<file>")
        size, sha = f.get("size"), f.get("sha256")
        if not isinstance(size, int) or size < 0 or not (isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{64}", sha)):
            raise Fail(400, "bad_request", "files: size (bytes) and sha256 (64 hex) required")
        out.append({"path": path, "size": size, "sha256": sha})
    return out


def post_message(who, task_id, body):
    task = get_task(task_id)
    kind = body.get("kind")
    if kind not in KINDS[CLAUDE] | KINDS[DRUZHOK]:
        raise Fail(400, "bad_request", f"Unknown kind {kind!r}")
    if kind not in KINDS[who]:
        raise Fail(403, "forbidden", f"{who} may not send {kind}")
    if task["status"] not in OPEN:
        raise Fail(409, "task_closed", f"Task {task_id} is {task['status']}")
    text = body.get("text") or ""
    _check_text(text)
    phase, percent = body.get("phase"), body.get("percent")
    _check_progress(phase, percent)
    files = _check_files(body.get("files"), task_id, who)
    client_id = body.get("client_id")
    if client_id is not None and not (isinstance(client_id, str) and 0 < len(client_id) <= 100):
        raise Fail(400, "bad_request", "client_id: a string up to 100 characters")
    m, task = add_message(task, who, kind, text, phase, percent, files, client_id)
    return {"message": msg_view(m), "task": task_view(task, who, now())}


# ---------- inbox, ping ----------

def _contiguous(msgs, since, t):
    """messages after `since` in number order, stopping at a gap that may still be in flight
    (a number taken, its message not written yet); a gap older than GAP_DEAD_SEC is a lost write"""
    out, expect = [], since + 1
    for m in msgs:
        if m["seq"] != expect and t - m["created_at"] < GAP_DEAD_SEC:
            break
        out.append(m)
        expect = m["seq"] + 1
    return out


def _read_new(who, since):
    t = now()
    msgs = _contiguous([m for m in store.table().query("MSG", f"{since:012d}") if m.get("ttl", t + 1) > t], since, t)
    last = msgs[-1]["seq"] if msgs else since
    return [m for m in msgs if m["from"] != who], last


def inbox(who, since=None, wait=0):
    tb = store.table()
    if since is None:
        cur = tb.get("CURSOR", who)
        since = cur["seq"] if cur else 0
    deadline = now() + wait
    while True:
        mine, last = _read_new(who, since)
        if mine or now() >= deadline:
            break
        since = last
        while now() < deadline:          # look at the cheap counter until something new is numbered
            sleep(WAIT_STEP)
            if (tb.get("META", "COUNTER") or {}).get("seq", 0) > last:
                break
    tb.put({"pk": "CURSOR", "sk": who, "seq": last})
    return _answer(who, mine, last)


def _answer(who, msgs, last):
    t, tb = now(), store.table()
    tasks = all_tasks()
    open_tasks = [x for x in tasks if x["status"] in OPEN]
    if who == DRUZHOK:
        for m in msgs:                   # first time druzhok sees a task
            task = next((x for x in open_tasks if x["sk"] == m["task_id"]), None)
            if m["kind"] == "task" and task and not task.get("seen_at"):
                task["seen_at"] = int(t)
                tb.update("TASK", task["sk"], {"seen_at": int(t)})
    if not open_tasks:
        mode, poll = "idle", IDLE_POLL
    elif all(x["status"] == "waiting" and t - x.get("waiting_since", t) > SLOW_WAITING_SEC for x in open_tasks):
        mode, poll = "active", IDLE_POLL
    else:
        mode, poll = "active", ACTIVE_POLL
    return {"mode": mode, "next_poll_sec": poll,
            "open_tasks": [task_view(x, who, t) for x in sorted(open_tasks, key=lambda x: x["sk"])],
            "messages": [msg_view(m) for m in msgs], "last_seq": last}


def ping(who, body):
    if who != DRUZHOK:
        raise Fail(403, "forbidden", "ping is for druzhok")
    items = body.get("tasks")
    if not isinstance(items, list) or len(items) > 100:
        raise Fail(400, "bad_request", "tasks: a list")
    for it in items:                     # check everything before changing anything
        if isinstance(it, dict):
            _check_progress(it.get("phase"), it.get("percent"))
    t, tb, ignored = now(), store.table(), []
    for it in items:
        tid = it.get("id") if isinstance(it, dict) else None
        task = tb.get("TASK", tid) if isinstance(tid, str) else None
        if not task or task["status"] not in OPEN:
            ignored.append(tid)
            continue
        phase, percent = it.get("phase"), it.get("percent")
        upd ={"last_ping_at": int(t), "pings": task.get("pings", 0) + 1}
        upd.update(_stall_count(task, t))
        if task["status"] == "new":
            upd["status"] = "in_progress"
        if phase is not None:
            upd["phase"] = phase
        if percent is not None:
            upd["percent"] = percent
        tb.update("TASK", tid, upd)
    since = body.get("since")
    if since is not None and (not isinstance(since, int) or isinstance(since, bool) or since < 0):
        raise Fail(400, "bad_request", "since: an integer")
    out = inbox(who, since, 0)
    if ignored:
        out["ignored"] = ignored
    return out


# ---------- lists and stats ----------

def list_tasks(who, status):
    if status not in ("open", "closed", "all"):
        raise Fail(400, "bad_request", "status: open | closed | all")
    t = now()
    tasks = [x for x in all_tasks() if status == "all" or (x["status"] in OPEN) == (status == "open")]
    tasks.sort(key=lambda x: x["sk"], reverse=True)
    return {"tasks": [task_view(x, who, t) for x in tasks[:50]]}


def task_full(who, task_id):
    task = get_task(task_id)
    t = now()
    msgs = sorted((m for m in store.table().query("MSG") if m["task_id"] == task_id and m.get("ttl", t + 1) > t),
                  key=lambda m: m["seq"])
    v = task_view(task, who, t)
    v["body"] = next((m["text"] for m in msgs if m["kind"] == "task"), "")
    v["messages"] = [msg_view(m) for m in msgs]
    return v


STAT_FIELDS = ("msgs_claude", "msgs_druzhok", "bytes_claude", "bytes_druzhok", "pings", "files", "file_bytes",
               "stalled_count")


def stats(who, days):
    if who != CLAUDE:
        raise Fail(403, "forbidden", "stats are for claude")
    t = now()
    tasks = [x for x in all_tasks() if x["created_at"] >= t - days * 86400]
    rows, total = [], {f: 0 for f in STAT_FIELDS}
    secs = lambda a, b: (b - a) if a and b else None
    for x in sorted(tasks, key=lambda x: x["sk"]):
        row = {"id": x["sk"], "title": x["title"], "status": x["status"],
               "to_seen_sec": secs(x["created_at"], x.get("seen_at")),
               "to_ack_sec": secs(x["created_at"], x.get("acked_at")),
               "to_result_sec": secs(x["created_at"], x.get("result_at")),
               "to_close_sec": secs(x["created_at"], x.get("closed_at"))}
        for f in STAT_FIELDS:
            row[f] = x.get(f, 0)
            total[f] += row[f]
        rows.append(row)
    total["tasks"] = len(rows)
    return {"days": days, "total": total, "tasks": rows}


# ---------- HTTP ----------

def route(method, path, query, body, who):
    m = re.fullmatch(r"/v1/tasks/(T-\d+)(/messages)?", path)
    if path == "/v1/inbox" and method == "GET":
        since = query.get("since")
        wait = query.get("wait", "0")
        if since is not None and not since.isdigit() or not wait.isdigit():
            raise Fail(400, "bad_request", "since, wait: integers")
        return 200, inbox(who, int(since) if since is not None else None, min(int(wait), WAIT_MAX))
    if path == "/v1/ping" and method == "POST":
        return 200, ping(who, body)
    if path == "/v1/tasks" and method == "GET":
        return 200, list_tasks(who, query.get("status", "open"))
    if path == "/v1/tasks" and method == "POST":
        if who != CLAUDE:
            raise Fail(403, "forbidden", "only claude creates tasks")
        task, msg = create_task(body)
        return 201, {"task": task_view(task, who, now()), "message": msg_view(msg)}
    if m and not m.group(2) and method == "GET":
        return 200, task_full(who, m.group(1))
    if m and m.group(2) and method == "POST":
        return 201, post_message(who, m.group(1), body)
    if path == "/v1/stats" and method == "GET":
        days = query.get("days", "7")
        if not days.isdigit():
            raise Fail(400, "bad_request", "days: an integer")
        return 200, stats(who, min(int(days), 365))
    raise Fail(404, "not_found", f"No route {method} {path}")


def _json(status, data, headers=None):
    return {"statusCode": status, "headers": dict({"Content-Type": "application/json; charset=utf-8"}, **(headers or {})),
            "body": json.dumps(data, ensure_ascii=False)}


def handler(event, context=None):
    try:
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
        path = (event.get("rawPath") or "/").rstrip("/") or "/"
        who = who_is(headers)
        rate_limit(who)
        raw = event.get("body") or ""
        if event.get("isBase64Encoded"):
            import base64
            raw = base64.b64decode(raw).decode()
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
