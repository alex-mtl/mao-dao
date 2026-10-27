import hashlib
import json
import os
import unittest

from aimail import handler as h, store

TOK = {"claude": "tok-claude", "druzhok": "tok-druzhok"}
os.environ["TOKEN_SHA256_CLAUDE"] = hashlib.sha256(TOK["claude"].encode()).hexdigest()
os.environ["TOKEN_SHA256_DRUZHOK"] = hashlib.sha256(TOK["druzhok"].encode()).hexdigest()


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


class Base(unittest.TestCase):
    def setUp(self):
        store.use(store.MemoryTable())
        self.clock = Clock()
        h.now, h.sleep = self.clock, self.clock.sleep

    def call(self, who, method, path, body=None, query=None, token=None):
        ev = {"rawPath": path, "requestContext": {"http": {"method": method}},
              "headers": {"Authorization": "Bearer " + (token or TOK[who])},
              "queryStringParameters": query, "body": json.dumps(body) if body is not None else None}
        r = h.handler(ev)
        return r["statusCode"], json.loads(r["body"])

    def ok(self, who, method, path, body=None, query=None):
        status, data = self.call(who, method, path, body, query)
        self.assertLess(status, 300, data)
        return data

    def task(self, title="Проверить слова", body="текст задания"):
        return self.ok("claude", "POST", "/v1/tasks", {"title": title, "body": body})["task"]["id"]

    def say(self, who, tid, kind, text="", **kw):
        return self.ok(who, "POST", f"/v1/tasks/{tid}/messages", dict(kw, kind=kind, text=text))


class FlowTest(Base):
    def test_idle_without_tasks(self):
        r = self.ok("druzhok", "GET", "/v1/inbox")
        self.assertEqual((r["mode"], r["next_poll_sec"], r["messages"], r["open_tasks"]), ("idle", 600, [], []))

    def test_full_cycle(self):
        tid = self.task()
        self.assertEqual(tid, "T-0001")
        self.clock.t += 420                                   # druzhok finds it 7 minutes later
        r = self.ok("druzhok", "GET", "/v1/inbox")
        self.assertEqual((r["mode"], r["next_poll_sec"]), ("active", 60))
        self.assertEqual([(m["task_id"], m["kind"], m["text"]) for m in r["messages"]],
                         [("T-0001", "task", "текст задания")])
        self.assertEqual(self.ok("druzhok", "GET", "/v1/inbox")["messages"], [])   # the cursor moved on
        self.assertEqual(self.say("druzhok", tid, "ack", "Получил T-0001")["task"]["status"], "in_progress")

        self.clock.t += 60
        r = self.ok("druzhok", "POST", "/v1/ping", {"tasks": [{"id": tid, "phase": "проверка", "percent": 30}]})
        self.assertEqual(r["open_tasks"][0]["percent"], 30)
        c = self.ok("claude", "GET", "/v1/inbox")
        self.assertEqual([m["kind"] for m in c["messages"]], ["ack"])            # pings are not messages
        self.assertEqual((c["open_tasks"][0]["phase"], c["open_tasks"][0]["stalled"]), ("проверка", False))

        self.say("claude", tid, "instruction", "Имена собственные пропускай")
        r = self.ok("druzhok", "POST", "/v1/ping", {"tasks": [{"id": tid}]})
        self.assertEqual([m["kind"] for m in r["messages"]], ["instruction"])     # ping brings the news

        self.assertEqual(self.say("druzhok", tid, "result", "12 опечаток")["task"]["status"], "review")
        self.assertEqual(self.say("claude", tid, "thanks", "спасибо.")["task"]["status"], "closed")
        r = self.ok("druzhok", "POST", "/v1/ping", {"tasks": [{"id": tid}]})
        self.assertEqual((r["mode"], r["next_poll_sec"], r["ignored"]), ("idle", 600, [tid]))
        status, err = self.call("druzhok", "POST", f"/v1/tasks/{tid}/messages", {"kind": "progress"})
        self.assertEqual((status, err["error"]["code"]), (409, "task_closed"))

        s = self.ok("claude", "GET", "/v1/stats")
        row = s["tasks"][0]
        self.assertEqual((row["to_seen_sec"], row["to_ack_sec"], row["pings"], row["msgs_druzhok"], row["msgs_claude"]),
                         (420, 420, 2, 2, 3))

    def test_parallel_tasks_and_review_back_to_work(self):
        a = self.task("A")
        self.ok("druzhok", "GET", "/v1/inbox")
        self.say("druzhok", a, "ack")
        b = self.task("B")
        r = self.ok("druzhok", "POST", "/v1/ping", {"tasks": [{"id": a}]})
        self.assertEqual([(m["task_id"], m["kind"]) for m in r["messages"]], [(b, "task")])
        self.assertEqual([t["id"] for t in r["open_tasks"]], [a, b])
        self.say("druzhok", a, "result", "готово")
        self.assertEqual(self.say("claude", a, "instruction", "поправь")["task"]["status"], "in_progress")
        self.say("claude", a, "thanks", "спасибо.")
        r = self.ok("druzhok", "GET", "/v1/inbox")
        self.assertEqual((r["mode"], [t["id"] for t in r["open_tasks"]]), ("active", [b]))   # B still open

    def test_question_and_slow_waiting(self):
        tid = self.task()
        self.say("druzhok", tid, "ack")
        self.assertEqual(self.say("druzhok", tid, "question", "какой язык?")["task"]["status"], "waiting")
        self.assertEqual(self.ok("druzhok", "GET", "/v1/inbox")["next_poll_sec"], 60)
        self.clock.t += 31 * 60
        r = self.ok("druzhok", "GET", "/v1/inbox")
        self.assertEqual((r["mode"], r["next_poll_sec"]), ("active", 600))
        self.assertFalse(self.ok("claude", "GET", "/v1/inbox")["open_tasks"][0]["stalled"])
        self.assertEqual(self.say("claude", tid, "answer", "русский")["task"]["status"], "in_progress")

    def test_stalled(self):
        tid = self.task()
        self.ok("druzhok", "GET", "/v1/inbox")
        self.say("druzhok", tid, "ack")
        self.clock.t += 200
        self.assertTrue(self.ok("claude", "GET", "/v1/inbox")["open_tasks"][0]["stalled"])
        self.ok("druzhok", "POST", "/v1/ping", {"tasks": [{"id": tid}]})
        self.assertFalse(self.ok("claude", "GET", "/v1/inbox")["open_tasks"][0]["stalled"])
        self.assertEqual(self.ok("claude", "GET", "/v1/stats")["tasks"][0]["stalled_count"], 1)

    def test_cancel(self):
        tid = self.task()
        self.assertEqual(self.say("claude", tid, "cancel", "не надо")["task"]["status"], "cancelled")
        r = self.ok("druzhok", "GET", "/v1/inbox")
        self.assertEqual(([m["kind"] for m in r["messages"]], r["mode"]), (["task", "cancel"], "idle"))

    def test_task_full_and_lists(self):
        tid = self.task(body="полный текст")
        self.say("druzhok", tid, "ack")
        full = self.ok("druzhok", "GET", f"/v1/tasks/{tid}")
        self.assertEqual((full["body"], [m["kind"] for m in full["messages"]]), ("полный текст", ["task", "ack"]))
        self.assertEqual([t["id"] for t in self.ok("druzhok", "GET", "/v1/tasks")["tasks"]], [tid])
        self.say("claude", tid, "thanks")
        self.assertEqual(self.ok("druzhok", "GET", "/v1/tasks")["tasks"], [])
        self.assertEqual([t["id"] for t in self.ok("druzhok", "GET", "/v1/tasks", query={"status": "closed"})["tasks"]], [tid])
        self.clock.t += 8 * 86400                              # a closed task is kept 7 days
        self.assertEqual(self.ok("druzhok", "GET", "/v1/tasks", query={"status": "all"})["tasks"], [])

    def test_since_explicit(self):
        tid = self.task()
        r = self.ok("druzhok", "GET", "/v1/inbox", query={"since": "0"})
        self.assertEqual(len(r["messages"]), 1)
        r2 = self.ok("druzhok", "GET", "/v1/inbox", query={"since": "0"})
        self.assertEqual(len(r2["messages"]), 1)                 # an explicit since re-reads
        self.say("claude", tid, "instruction", "x")
        r3 = self.ok("druzhok", "GET", "/v1/inbox", query={"since": str(r["last_seq"])})
        self.assertEqual([m["kind"] for m in r3["messages"]], ["instruction"])


class LongPollTest(Base):
    def test_wait_returns_when_a_message_comes(self):
        tid = self.task()
        self.ok("druzhok", "GET", "/v1/inbox")
        calls = []

        def sleep(s):                                          # claude writes while druzhok waits
            self.clock.t += s
            calls.append(s)
            if len(calls) == 3:
                h.add_message(store.table().get("TASK", tid), "claude", "instruction", "новое")
        h.sleep = sleep
        r = self.ok("druzhok", "GET", "/v1/inbox", query={"wait": "25"})
        self.assertEqual(([m["text"] for m in r["messages"]], len(calls)), (["новое"], 3))

    def test_wait_times_out(self):
        r = self.ok("claude", "GET", "/v1/inbox", query={"wait": "10"})
        self.assertEqual(r["messages"], [])
        self.assertGreaterEqual(self.clock.t, 1_800_000_010)

    def test_gap_in_flight_is_not_skipped(self):
        tid = self.task()
        tb = store.table()
        tb.add("META", "COUNTER", "seq")                      # seq 2 taken, its message not written yet
        task = tb.get("TASK", tid)
        h.add_message(task, "claude", "instruction", "три")    # seq 3
        r = self.ok("druzhok", "GET", "/v1/inbox")
        self.assertEqual(([m["seq"] for m in r["messages"]], r["last_seq"]), ([1], 1))
        self.clock.t += 31                                     # the write of seq 2 was lost
        r = self.ok("druzhok", "GET", "/v1/inbox")
        self.assertEqual(([m["seq"] for m in r["messages"]], r["last_seq"]), ([3], 3))


class RulesTest(Base):
    def test_auth(self):
        status, err = self.call("claude", "GET", "/v1/inbox", token="wrong")
        self.assertEqual((status, err["error"]["code"]), (401, "unauthorized"))

    def test_kinds_per_side(self):
        tid = self.task()
        status, err = self.call("druzhok", "POST", f"/v1/tasks/{tid}/messages", {"kind": "thanks"})
        self.assertEqual((status, err["error"]["code"]), (403, "forbidden"))
        status, _ = self.call("claude", "POST", f"/v1/tasks/{tid}/messages", {"kind": "result"})
        self.assertEqual(status, 403)
        status, _ = self.call("druzhok", "POST", "/v1/tasks", {"title": "x"})
        self.assertEqual(status, 403)
        status, _ = self.call("claude", "POST", "/v1/ping", {"tasks": []})
        self.assertEqual(status, 403)
        status, _ = self.call("druzhok", "GET", "/v1/stats")
        self.assertEqual(status, 403)
        status, err = self.call("claude", "POST", f"/v1/tasks/{tid}/messages", {"kind": "hello"})
        self.assertEqual((status, err["error"]["code"]), (400, "bad_request"))
        status, _ = self.call("claude", "POST", "/v1/tasks/T-9999/messages", {"kind": "answer"})
        self.assertEqual(status, 404)

    def test_limits(self):
        tid = self.task()
        status, _ = self.call("druzhok", "POST", f"/v1/tasks/{tid}/messages",
                              {"kind": "result", "text": "я" * (h.TEXT_MAX // 2 + 1)})
        self.assertEqual(status, 400)
        status, _ = self.call("druzhok", "POST", f"/v1/tasks/{tid}/messages", {"kind": "progress", "percent": 101})
        self.assertEqual(status, 400)
        status, _ = self.call("druzhok", "POST", "/v1/ping", {"tasks": [{"id": tid, "percent": "x"}]})
        self.assertEqual(status, 400)

    def test_files(self):
        tid = self.task()
        sha = "a" * 64
        r = self.say("druzhok", tid, "result", "отчёт", files=[{"path": f"{tid}/druzhok/report.pdf", "size": 1000, "sha256": sha}])
        self.assertEqual(r["message"]["files"][0]["path"], f"{tid}/druzhok/report.pdf")
        for bad in ({"path": f"{tid}/claude/x.pdf", "size": 1, "sha256": sha},          # not its own folder
                    {"path": f"{tid}/druzhok/../../etc/passwd", "size": 1, "sha256": sha},
                    {"path": f"{tid}/druzhok/x.pdf", "size": 1, "sha256": "zz"}):
            status, _ = self.call("druzhok", "POST", f"/v1/tasks/{tid}/messages", {"kind": "progress", "files": [bad]})
            self.assertEqual(status, 400, bad)
        self.assertEqual((self.ok("claude", "GET", "/v1/stats")["total"]["files"]), 1)

    def test_client_id_dedup(self):
        tid = self.task()
        a = self.say("druzhok", tid, "ack", "x", client_id="d-1")
        b = self.say("druzhok", tid, "ack", "x", client_id="d-1")
        self.assertEqual(a["message"]["seq"], b["message"]["seq"])
        self.assertEqual(len(self.ok("druzhok", "GET", f"/v1/tasks/{tid}")["messages"]), 2)

    def test_rate_limit(self):
        for _ in range(h.RATE_PER_MIN):
            self.ok("druzhok", "GET", "/v1/inbox")
        status, err = self.call("druzhok", "GET", "/v1/inbox")
        self.assertEqual((status, err["error"]["code"]), (429, "rate_limited"))
        self.clock.t += 60
        self.ok("druzhok", "GET", "/v1/inbox")


if __name__ == "__main__":
    unittest.main()
