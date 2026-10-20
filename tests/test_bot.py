import json
import unittest

from bot import handler, store, tg


def call(path, body, key=None):
    headers = {"Authorization": "Bearer " + key} if key else {"X-Telegram-Bot-Api-Secret-Token": "s"}
    r = handler.lambda_handler({"rawPath": path, "headers": headers, "body": json.dumps(body)}, None)
    return r["statusCode"], json.loads(r["body"])


def msg(text, uid=7):
    return {"message": {"chat": {"id": uid}, "from": {"id": uid, "username": "vasya", "first_name": "Вася"}, "text": text}}


class BotTest(unittest.TestCase):
    def setUp(self):
        store.use(store.MemoryTable())
        tg.sent = []
        tg.markups.clear()
        tg.answers.clear()
        tg.deleted.clear()
        tg._params.update({"webhook-secret": "s", "bot_name": "test_bot", "token": "x"})
        self.key = handler.admin({"action": "add_game", "id": "mao"})["game_key"]
        self.key2 = handler.admin({"action": "add_game", "id": "other"})["game_key"]

    def start(self, key=None):
        code, r = call("/game/stream/start", {}, key or self.key)
        self.assertEqual(code, 200)
        return r["word"]

    def get_key(self, word, nick="vorobey", uid=7):
        call("/tg", msg(word, uid))
        call("/tg", msg("@" + nick, uid))
        return tg.sent[-1][1].split("<code>")[1].split("</code>")[0]

    def test_full_cycle(self):
        word = self.start()
        self.assertEqual(self.start(), word)                       # game restart keeps the word
        call("/tg", msg("/start"))
        key = self.get_key(word.upper())
        self.assertRegex(key, r"^ключ-тг-[A-Za-z0-9_-]{8}$")
        code, r = call("/game/key", {"key": "вот " + key, "tiktok_id": "Vorobey", "tiktok_name": "воробей"}, self.key)
        self.assertEqual(r, {"ok": True, "linked": True, "first": True})
        self.assertIn("подтверждён", tg.sent[-1][1])
        self.assertEqual(call("/game/key", {"key": key, "tiktok_id": "vorobey"}, self.key)[1]["reason"], "unknown")
        call("/game/push", {"tiktok_id": "vorobey", "text": "привет"}, self.key)
        self.assertEqual(tg.sent[-1], (7, "привет"))

    def test_word_and_nick_in_one_message(self):
        word = self.start()
        call("/tg", msg(word + " https://www.tiktok.com/@Vorobey?lang=ru"))
        self.assertIn("ключ-тг-", tg.sent[-1][1])

    def test_wrong_account_and_other_game(self):
        word = self.start()
        self.start(self.key2)
        key = self.get_key(word)
        self.assertEqual(call("/game/key", {"key": key, "tiktok_id": "vorobey"}, self.key2)[1]["reason"], "unknown")
        self.assertEqual(call("/game/key", {"key": key, "tiktok_id": "sinica"}, self.key)[1]["reason"], "other_account")
        self.assertIn("@sinica", tg.sent[-1][1])
        self.assertTrue(call("/game/key", {"key": key, "tiktok_id": "vorobey"}, self.key)[1]["ok"])

    def test_words_unique_and_stop(self):
        self.assertNotEqual(self.start(), self.start(self.key2))
        word = self.start()
        call("/game/stream/stop", {}, self.key)
        call("/tg", msg(word))
        self.assertIn("Не нашёл", tg.sent[-1][1])

    def test_owner_and_superadmin_get_every_link(self):
        self.assertIn("error", handler.admin({"action": "set_superadmin", "username": "boss"}))
        call("/tg", {"message": {"chat": {"id": 9}, "from": {"id": 9, "username": "Boss"}, "text": "привет"}})
        self.assertTrue(handler.admin({"action": "set_superadmin", "username": "@boss"})["ok"])
        self.assertIn("суперадмин", tg.sent[-1][1])
        word = self.start()
        self.assertEqual(call("/game/host_code", {}, "nope")[0], 401)
        link = call("/game/host_code", {}, self.key)[1]["link"]
        self.assertTrue(link.startswith("https://t.me/test_bot?start=host_"))
        cmd = "/start " + link.split("start=")[1]                  # what the messenger sends on opening the link
        tg.sent.clear()
        call("/tg", msg(cmd, uid=1))
        self.assertIn("ведущий стрима <b>" + word.upper(), tg.sent[0][1])
        self.assertEqual(tg.sent[1][0], 9)                           # the superadmin hears about the new host
        self.assertIn("новый ведущий", tg.sent[1][1])
        call("/tg", msg(cmd, uid=2))
        self.assertIn("не подошла", tg.sent[-1][1])                 # one-time
        key = self.get_key(word)
        tg.sent.clear()
        call("/game/key", {"key": key, "tiktok_id": "vorobey", "tiktok_name": "воробей"}, self.key)
        self.assertEqual([c for c, _ in tg.sent], [7, 1, 9])          # viewer, streamer, superadmin
        for part in ("@vorobey", "воробей", "@vasya", "Вася", "mao"):
            self.assertIn(part, tg.sent[-1][1])

    def test_key_with_dash(self):
        real = handler.os.urandom
        handler.os.urandom = lambda n: bytes.fromhex("fbefbe") * (n // 3)    # base64 "----"
        try:
            key = self.get_key(self.start())
        finally:
            handler.os.urandom = real
        self.assertEqual(key, "ключ-тг---------")
        self.assertTrue(call("/game/key", {"key": key, "tiktok_id": "vorobey"}, self.key)[1]["ok"])

    def test_riddle_cycle(self):
        word = self.start()
        key = self.get_key(word)                                     # viewer vorobey (tg 7) links
        call("/game/key", {"key": key, "tiktok_id": "vorobey", "tiktok_name": "воробей"}, self.key)
        call("/tg", msg("загадывает", uid=5))
        self.assertIn("только для ведущего", tg.sent[-1][1])
        link = call("/game/host_code", {}, self.key)[1]["link"]
        call("/tg", msg("/start " + link.split("start=")[1], uid=5))   # tg 5 becomes the host
        self.assertIn((5, {"commands": ["start", "help", "pick"]}), tg.markups)   # the host's menu
        tg.markups.clear()
        call("/tg", msg("Загадывает вороб", uid=5))
        chat, kb = tg.markups[-1]
        self.assertEqual(kb["inline_keyboard"][0][0]["callback_data"], "pick:vorobey")
        tg.markups.clear()
        call("/tg", msg("загадывает @Vasya", uid=5))                 # the viewer's messenger nick works too
        self.assertEqual(tg.markups[-1][1]["inline_keyboard"][0][0]["callback_data"], "pick:vorobey")
        tg.markups.clear()
        call("/tg", msg("/pick вороб", uid=5))                         # the menu's synonym
        self.assertEqual(tg.markups[-1][1]["inline_keyboard"][0][0]["callback_data"], "pick:vorobey")
        call("/tg", msg("/help", uid=5))
        self.assertIn("/pick", tg.sent[-1][1])                         # the host's help
        call("/tg", msg("/help", uid=8))
        self.assertNotIn("/pick", tg.sent[-1][1])                      # a viewer's help
        call("/tg", msg("загадывает сокол", uid=5))
        self.assertIn("Не нашёл", tg.sent[-1][1])
        cb = lambda data: call("/tg", {"callback_query": {"id": "c", "from": {"id": 5}, "data": data,
                                                          "message": {"chat": {"id": 5}, "message_id": 1}}})
        cb("pick:vorobey")
        self.assertEqual(tg.sent[-2][0], 7)                            # the question to the viewer
        self.assertIn("Спросил", tg.sent[-1][1])
        call("/tg", msg("Огурцы"))
        self.assertIn("Проверяю", tg.sent[-1][1])
        call("/tg", msg("ещё"))
        self.assertIn("ещё проверяется", tg.sent[-1][1])
        r = call("/game/poll", {}, self.key)[1]
        self.assertEqual([w["word"] for w in r["words"]], ["Огурцы"])
        wid = r["words"][0]["id"]
        self.assertEqual(call("/game/poll", {}, self.key)[1], {"words": [], "cancel": []})   # given once
        call("/game/poll", {"results": [{"id": wid, "ok": False}]}, self.key)
        self.assertIn("нет в словаре", tg.sent[-2][1])
        self.assertIn("не найдено", tg.sent[-1][1])
        call("/tg", msg("огурец"))                                     # the question is still open
        wid = call("/game/poll", {}, self.key)[1]["words"][0]["id"]
        tg.markups.clear()
        call("/game/poll", {"results": [{"id": wid, "ok": True, "word": "огурец", "round": 12}]}, self.key)
        self.assertIn("раунде <b>12</b>", tg.sent[-2][1])
        self.assertEqual(tg.markups[-1][1]["inline_keyboard"][0][1]["callback_data"], "rej:" + wid)
        call("/tg", msg("привет"))                                     # question closed: normal dialog again
        self.assertIn("Не нашёл стрим", tg.sent[-1][1])
        self.assertEqual([b["callback_data"] for b in tg.markups[-1][1]["inline_keyboard"][0]], ["ok:" + wid, "rej:" + wid])
        cb("rej:" + wid)
        self.assertIn("отклонил", tg.sent[-1][1])                     # the viewer is told
        self.assertIn("Отклонено", tg.answers[-1])                    # the host: a popup...
        self.assertEqual(tg.deleted[-1], (5, 1))                      # ...and the message is gone
        cb("rej:" + wid)
        self.assertIn("не отменить", tg.answers[-1])
        self.assertEqual(call("/game/poll", {}, self.key)[1]["cancel"], [wid])
        self.assertEqual(call("/game/poll", {}, self.key)[1]["cancel"], [])

    def test_riddle_played(self):
        word = self.start()
        key = self.get_key(word)
        call("/game/key", {"key": key, "tiktok_id": "vorobey", "tiktok_name": "воробей"}, self.key)
        link = call("/game/host_code", {}, self.key)[1]["link"]
        call("/tg", msg("/start " + link.split("start=")[1], uid=5))
        call("/tg", {"callback_query": {"id": "c", "from": {"id": 5}, "data": "pick:vorobey",
                                        "message": {"chat": {"id": 5}, "message_id": 1}}})
        call("/tg", msg("огурец"))
        wid = call("/game/poll", {}, self.key)[1]["words"][0]["id"]
        call("/game/poll", {"results": [{"id": wid, "ok": True, "word": "огурец", "round": 3}]}, self.key)
        cb = {"callback_query": {"id": "c", "from": {"id": 5}, "data": "ok:" + wid,
                                 "message": {"chat": {"id": 5}, "message_id": 2}}}
        call("/tg", cb)
        self.assertIn("Принято: ОГУРЕЦ", tg.answers[-1])
        self.assertEqual(tg.deleted[-1], (5, 2))
        call("/game/poll", {"played": [wid]}, self.key)
        self.assertIn("загадано прямо сейчас", tg.sent[-1][1])
        log = store.get("EVLOG#mao#" + __import__("time").strftime("%Y-%m-%d", __import__("time").gmtime()))
        self.assertEqual([x["type"] for x in log["events"]],
                         ["link", "host", "ask", "word_sent", "word_queued", "word_accepted", "word_played"])

    def test_auth(self):
        self.assertEqual(call("/game/stream/start", {}, "nope")[0], 401)
        r = handler.lambda_handler({"rawPath": "/tg", "headers": {"x-telegram-bot-api-secret-token": "bad"},
                                    "body": "{}"}, None)
        self.assertEqual(r["statusCode"], 403)


if __name__ == "__main__":
    unittest.main()
