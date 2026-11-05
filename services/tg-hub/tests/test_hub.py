import base64
import hashlib
import json
import os
import unittest

from tghub import handler as h, store, tg

TOK = {"druzhok": "tok-druzhok", "claude": "tok-claude"}
os.environ["TOKEN_SHA256_DRUZHOK"] = hashlib.sha256(TOK["druzhok"].encode()).hexdigest()
os.environ["TOKEN_SHA256_CLAUDE"] = hashlib.sha256(TOK["claude"].encode()).hexdigest()
os.environ["OWNER_IDS"] = "111"
tg._params.update({"token": "999:secret", "webhook-secret": "hook", "username": "hub_bot"})

OWNER = {"id": 111, "first_name": "Alex", "username": "alex"}
GUEST = {"id": 222, "first_name": "Ivan"}
BOT = {"id": 999, "is_bot": True, "first_name": "Hub", "username": "hub_bot"}
GROUP = {"id": -100500, "type": "supergroup", "title": "DoctorVet"}


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
        self.calls, self.next_mid, self.upd = [], 1000, 0
        tg.fake = self.fake

    def fake(self, method, data):
        self.calls.append((method, data))
        if method == "sendMessage":
            self.next_mid += 1
            return {"message_id": self.next_mid, "date": int(self.clock.t), "chat": {"id": data["chat_id"]},
                    "from": BOT, "text": data["text"]}
        if method == "getFile":
            return {"file_id": data["file_id"], "file_path": "photos/file_1.jpg",
                    "file_size": 10 if data["file_id"] != "big_file_id_x" else 9 * 1024 * 1024}
        if method == "download":
            return b"JPEGDATA!!"
        return True

    def hook(self, update, secret="hook"):
        self.upd += 1
        ev = {"rawPath": "/tg", "requestContext": {"http": {"method": "POST"}},
              "headers": {"X-Telegram-Bot-Api-Secret-Token": secret}, "body": json.dumps(dict(update, update_id=self.upd))}
        return h.handler(ev)["statusCode"]

    def msg(self, mid, text, user=OWNER, chat=GROUP, **kw):
        return self.hook({"message": dict(kw, message_id=mid, date=int(self.clock.t), chat=chat, text=text,
                                          **{"from": user})})

    def call(self, method, path, body=None, query=None, who="druzhok", token=None):
        ev = {"rawPath": path, "requestContext": {"http": {"method": method}},
              "headers": {"Authorization": "Bearer " + (token or TOK[who])},
              "queryStringParameters": query, "body": json.dumps(body) if body is not None else None}
        r = h.handler(ev)
        return r["statusCode"], (json.loads(r["body"]) if r["headers"]["Content-Type"].startswith("application/json")
                                 else r)

    def ok(self, method, path, body=None, query=None, who="druzhok"):
        status, data = self.call(method, path, body, query, who)
        self.assertLess(status, 300, data)
        return data

    def added(self, chat=GROUP, by=OWNER):
        self.hook({"my_chat_member": {"chat": chat, "from": by, "date": 1,
                                      "old_chat_member": {"status": "left", "user": BOT},
                                      "new_chat_member": {"status": "administrator", "user": BOT}}})


class HubTest(Base):
    def test_webhook_secret_and_auth(self):
        self.assertEqual(self.hook({"message": {}}, secret="wrong"), 403)
        self.assertEqual(self.call("GET", "/v1/events", token="nope")[0], 401)

    def test_bot_added_then_project_then_messages(self):
        self.added()
        ev = self.ok("GET", "/v1/events")["events"]
        self.assertEqual((ev[0]["kind"], ev[0]["by"]["is_owner"], ev[0]["known"]), ("bot_added", True, False))

        self.msg(1, "/project doctorvet")                    # owner binds the group
        self.assertIn("doctorvet", self.calls[-1][1]["text"])
        self.assertEqual(self.ok("GET", "/v1/chats")["chats"][0]["project"], "doctorvet")

        self.msg(2, "Нужны посты про вакцинацию котов", user=GUEST)
        self.msg(3, "Дружок, прочти последние сообщения и сделай 5 постов")
        evs = self.ok("GET", "/v1/events")["events"]
        self.assertEqual([e["kind"] for e in evs], ["chat_project", "message", "message"])
        self.assertEqual(evs[1]["chat"]["project"], "doctorvet")
        self.assertNotIn("addressed", evs[1])
        self.assertTrue(evs[2]["addressed"])
        self.assertEqual(self.ok("GET", "/v1/events")["events"], [])      # the cursor moved on

        r = self.ok("GET", "/v1/messages", query={"chat": "doctorvet", "limit": "3"})
        self.assertEqual([m["message_id"] for m in r["messages"]], [2, 3, 1001])   # 1001: the bot's "bound" reply
        self.assertEqual(r["messages"][2]["from"]["id"], 999)
        self.assertEqual(r["messages"][0]["from"]["name"], "Ivan")

    def test_reply_to_an_old_message_keeps_it(self):
        self.added()
        old = {"message_id": 7, "date": 1_700_000_000, "chat": GROUP, "from": GUEST, "text": "старая идея"}
        self.msg(50, "вот это сделать", reply_to_message=old)
        ev = self.ok("GET", "/v1/events")["events"][-1]
        self.assertEqual((ev["message"]["reply_to"], ev["reply_to_message"]["text"]), (7, "старая идея"))
        r = self.ok("GET", f"/v1/messages/{GROUP['id']}/7")
        self.assertEqual(r["message"]["text"], "старая идея")

    def test_reply_to_the_bot_is_addressed(self):
        self.added()
        self.ok("POST", "/v1/chats/-100500", {"project": "doctorvet"})
        sent = self.ok("POST", "/v1/send", {"chat": "doctorvet", "text": "Принято в работу"})["messages"][0]
        self.assertEqual(sent["sent_by"], "druzhok")
        self.ok("GET", "/v1/events")
        self.msg(60, "а ещё добавь фото", reply_to_message={"message_id": sent["message_id"], "chat": GROUP,
                                                            "from": BOT, "date": 1, "text": "Принято в работу"})
        self.assertTrue(self.ok("GET", "/v1/events")["events"][0]["addressed"])

    def test_send_long_text_is_split_and_reply(self):
        self.added()
        text = ("абзац " * 300 + "\n") * 3
        r = self.ok("POST", "/v1/send", {"chat": str(GROUP["id"]), "text": text, "reply_to": 5})
        self.assertGreater(len(r["messages"]), 1)
        sends = [d for m, d in self.calls if m == "sendMessage"]
        self.assertTrue(all(len(d["text"]) <= 4096 for d in sends))
        self.assertIn("reply_parameters", sends[0])
        self.assertNotIn("reply_parameters", sends[1])

    def test_media_reactions_edits(self):
        self.added()
        self.hook({"message": {"message_id": 9, "date": 1, "chat": GROUP, "from": OWNER, "caption": "логотип",
                               "photo": [{"file_id": "small_file_id", "file_unique_id": "a", "width": 90, "height": 90},
                                         {"file_id": "large_file_id", "file_unique_id": "b", "width": 900,
                                          "height": 900}]}})
        self.hook({"message_reaction": {"chat": GROUP, "message_id": 9, "user": GUEST, "date": 2,
                                        "old_reaction": [], "new_reaction": [{"type": "emoji", "emoji": "👍"}]}})
        self.hook({"edited_message": {"message_id": 9, "date": 1, "edit_date": 3, "chat": GROUP, "from": OWNER,
                                      "caption": "логотип v2", "photo": [{"file_id": "large_file_id",
                                                                          "file_unique_id": "b"}]}})
        evs = self.ok("GET", "/v1/events")["events"]
        self.assertEqual([e["kind"] for e in evs], ["bot_added", "message", "reaction", "edit"])
        self.assertEqual(evs[1]["message"]["media"]["file_id"], "large_file_id")
        self.assertEqual((evs[2]["new"], evs[2]["message_text"]), (["👍"], "логотип"))
        m = self.ok("GET", f"/v1/messages/{GROUP['id']}/9")["message"]
        self.assertEqual((m["text"], m["reactions"]["222"]["emoji"]), ("логотип v2", ["👍"]))

        status, r = self.call("GET", "/v1/file", query={"file_id": "large_file_id"})
        self.assertEqual((status, base64.b64decode(r["body"])), (200, b"JPEGDATA!!"))
        self.assertEqual(self.call("GET", "/v1/file", query={"file_id": "big_file_id_x"})[0], 413)

    def test_unknown_group_and_guest_cannot_bind(self):
        other = {"id": -100777, "type": "supergroup", "title": "Чужая"}
        self.added(other, by=GUEST)
        ev = self.ok("GET", "/v1/events")["events"][0]
        self.assertEqual((ev["by_owner"], ev["known"]), (False, False))
        self.msg(1, "/project spam", user=GUEST, chat=other)          # not the owner: just a message
        self.assertIsNone(self.ok("GET", "/v1/chats")["chats"][0].get("project"))

    def test_project_names_unique_and_migration(self):
        basic = {"id": -42, "type": "group", "title": "DV"}
        self.added(basic)
        self.msg(1, "/project doctorvet", chat=basic)
        other = {"id": -43, "type": "group", "title": "Other"}
        self.added(other)
        self.msg(1, "/project doctorvet", chat=other)
        self.assertIn("bound", self.calls[-1][1]["text"])
        self.hook({"message": {"message_id": 5, "date": 1, "chat": basic, "from": OWNER,
                               "migrate_to_chat_id": -100042}})
        self.hook({"message": {"message_id": 1, "date": 1, "chat": {"id": -100042, "type": "supergroup", "title": "DV"},
                               "from": OWNER, "migrate_from_chat_id": -42}})
        self.msg(2, "уже в супергруппе", chat={"id": -100042, "type": "supergroup", "title": "DV"})
        r = self.ok("GET", "/v1/messages", query={"chat": "doctorvet"})
        self.assertEqual((r["chat"]["chat_id"], [m["text"] for m in r["messages"]]), (-100042, ["уже в супергруппе"]))

    def test_duplicate_update_ignored(self):
        self.added()
        body = {"update_id": 77, "message": {"message_id": 1, "date": 1, "chat": GROUP, "from": GUEST, "text": "x"}}
        for _ in range(2):
            h.handler({"rawPath": "/tg", "headers": {"X-Telegram-Bot-Api-Secret-Token": "hook"},
                       "body": json.dumps(body)})
        self.assertEqual(len(self.ok("GET", "/v1/events")["events"]), 2)

    def test_long_poll_and_paging(self):
        self.added()
        for i in range(5):
            self.msg(i + 1, f"m{i}", user=GUEST)
        r = self.ok("GET", "/v1/events", query={"limit": "3"})
        self.assertEqual((len(r["events"]), r["has_more"], r["next_poll_sec"]), (3, True, 0))
        r = self.ok("GET", "/v1/events", query={"limit": "3"})
        self.assertEqual((len(r["events"]), r["has_more"], r["next_poll_sec"]), (3, False, 10))
        t0 = self.clock.t
        self.assertEqual(self.ok("GET", "/v1/events", query={"wait": "20"})["events"], [])
        self.assertGreaterEqual(self.clock.t - t0, 20)
        r = self.ok("GET", "/v1/events", query={"since": "0", "limit": "200"}, who="claude")
        self.assertEqual(len(r["events"]), 6)                      # claude has its own cursor

    def test_thread_filter_and_before(self):
        self.added()
        for i in range(1, 7):
            self.msg(i, f"t{i}", user=GUEST, message_thread_id=5 if i % 2 else None, is_topic_message=bool(i % 2))
        r = self.ok("GET", "/v1/messages", query={"chat": str(GROUP["id"]), "thread": "5"})
        self.assertEqual([m["message_id"] for m in r["messages"]], [1, 3, 5])
        r = self.ok("GET", "/v1/messages", query={"chat": str(GROUP["id"]), "before": "4", "limit": "2"})
        self.assertEqual([m["message_id"] for m in r["messages"]], [2, 3])


if __name__ == "__main__":
    unittest.main()
