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
        tg.temp.clear()
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

    def host_and_viewer(self):
        """viewer vorobey (tg 7) linked, tg 5 is the host"""
        word = self.start()
        key = self.get_key(word)
        call("/game/key", {"key": key, "tiktok_id": "vorobey", "tiktok_name": "воробей"}, self.key)
        link = call("/game/host_code", {}, self.key)[1]["link"]
        call("/tg", msg("/start " + link.split("start=")[1], uid=5))
        return word

    def cb(self, data, mid=1):
        call("/tg", {"callback_query": {"id": "c", "from": {"id": 5}, "data": data,
                                        "message": {"chat": {"id": 5}, "message_id": mid}}})

    def poll(self, body=None):
        return call("/game/poll", dict(body or {}, v=2), self.key)[1]

    def test_host_picks_viewer(self):
        call("/tg", msg("загадывает", uid=5))
        self.assertIn("только для ведущего", tg.sent[-1][1])
        self.host_and_viewer()
        self.assertIn((5, {"commands": ["start", "help", "zagadka", "game", "pick", "queue"]}), tg.markups)
        for q in ("Загадывает вороб", "загадывает @Vasya", "/pick вороб"):   # nick, messenger nick, menu synonym
            tg.markups.clear()
            call("/tg", msg(q, uid=5))
            self.assertEqual(tg.markups[-1][1]["inline_keyboard"][0][0]["callback_data"], "pick:vorobey", q)
        call("/tg", msg("/help", uid=5))
        self.assertIn("/pick", tg.sent[-1][1])                         # the host's help
        call("/tg", msg("/help", uid=8))
        self.assertNotIn("/pick", tg.sent[-1][1])                      # a viewer's help
        self.assertIn("/zagadka", tg.sent[-1][1])
        call("/tg", msg("загадывает сокол", uid=5))
        self.assertIn("Не нашёл", tg.sent[-1][1])
        self.cb("pick:vorobey")
        self.assertEqual(tg.sent[-2][0], 7)                            # the question to the viewer
        self.assertIn("Спросил", tg.sent[-1][1])
        call("/tg", msg("Огурцы"))
        self.assertIn("Проверяю", tg.sent[-1][1])
        call("/tg", msg("ещё"))
        self.assertIn("ждёт проверки", tg.sent[-1][1])
        self.assertEqual(call("/game/poll", {}, self.key)[1]["words"], [])   # an old game gets no new words
        r = self.poll()
        self.assertEqual([(w["word"], w["action"]) for w in r["words"]], [("Огурцы", "check")])
        wid = r["words"][0]["id"]
        self.assertEqual(self.poll(), {"words": [], "cancel": []})     # given once
        self.poll({"results": [{"id": wid, "stage": "check", "ok": False}]})
        self.assertIn("нет в словаре", tg.sent[-2][1])
        self.assertIn("не найдено", tg.sent[-1][1])
        call("/tg", msg("огурец"))                                     # the question is still open
        wid = self.poll()["words"][0]["id"]
        tg.markups.clear()
        self.poll({"results": [{"id": wid, "stage": "check", "ok": True, "word": "огурец"}]})
        self.assertIn("Жду решения ведущего", tg.sent[-2][1])
        self.assertIn("предлагает слово «<b>ОГУРЕЦ", tg.sent[-1][1])
        self.assertEqual([b["callback_data"] for b in tg.markups[-1][1]["inline_keyboard"][0]], ["ok:" + wid, "rej:" + wid])
        self.assertEqual(self.poll()["words"], [])                     # nothing goes to a round without the host
        call("/tg", msg("привет"))                                     # question closed: normal dialog again
        self.assertIn("Не нашёл стрим", tg.sent[-1][1])
        self.cb("rej:" + wid)
        self.assertIn("отклонил", tg.sent[-1][1])                     # the viewer is told
        self.assertIn("Отклонено", tg.answers[-1])                    # the host: a popup...
        self.assertEqual(tg.deleted[-1], (5, 1))                      # ...and the message is gone
        self.assertEqual(self.poll(), {"words": [], "cancel": []})     # never reached the game
        self.cb("rej:" + wid)
        self.assertIn("не отменить", tg.answers[-1])

    def test_viewer_offers_and_host_accepts(self):
        call("/tg", msg("/zagadka", uid=8))
        self.assertIn("/start", tg.sent[-1][1])                        # not linked yet
        self.host_and_viewer()
        call("/tg", msg("/zagadka"))
        self.assertIn("Ведущий решит", tg.sent[-1][1])
        call("/tg", msg("огурец"))
        wid = self.poll()["words"][0]["id"]
        self.poll({"results": [{"id": wid, "stage": "check", "ok": True, "word": "огурец"}]})
        self.cb("ok:" + wid, mid=2)
        self.assertIn("Принято: ОГУРЕЦ", tg.answers[-1])
        self.assertEqual(tg.deleted[-1], (5, 2))
        r = self.poll()                                               # only now the game queues it
        self.assertEqual([(w["word"], w["action"]) for w in r["words"]], [("огурец", "queue")])
        call("/tg", msg("/queue", uid=7))
        self.assertIn("только для ведущего", tg.sent[-1][1])          # the host's command only
        call("/tg", msg("очередь", uid=5))
        self.assertEqual(tg.temp[-1][0], 5)
        self.assertIn("Раунд … — <b>ОГУРЕЦ</b> (воробей)", tg.temp[-1][1])   # accepted, round not known yet
        self.poll({"results": [{"id": wid, "stage": "queue", "ok": True, "round": 7}]})
        self.assertIn("раунде <b>7</b>", tg.sent[-2][1])               # the viewer
        self.assertEqual(tg.temp[-1], (5, "✅ «<b>ОГУРЕЦ</b>» от <b>воробей</b> — раунд <b>7</b>", 60))  # the host
        call("/tg", msg("/queue", uid=5))
        self.assertIn("Раунд 7 — <b>ОГУРЕЦ</b> (воробей)", tg.temp[-1][1])
        self.assertEqual(tg.temp[-1][2], 60)
        call("/tg", msg("загадка"))                                    # the text synonym; a new word is fine now
        self.assertIn("Ведущий решит", tg.sent[-1][1])
        self.poll({"played": [wid]})
        self.assertIn("загадано прямо сейчас", tg.sent[-1][1])
        call("/tg", msg("/queue", uid=5))
        self.assertIn("пуста", tg.temp[-1][1])
        log = store.get("EVLOG#mao#" + __import__("time").strftime("%Y-%m-%d", __import__("time").gmtime()))
        self.assertEqual([x["type"] for x in log["events"]],
                         ["link", "host", "ask_self", "word_sent", "word_checked", "word_accepted", "word_queued",
                          "ask_self", "word_played"])

    def test_switch_game(self):
        self.host_and_viewer()
        other = self.start(self.key2)
        call("/tg", msg("/game"))
        self.assertIn("Пришли слово стрима", tg.sent[-1][1])
        call("/tg", msg("абырвалг"))
        self.assertIn("Не нашёл", tg.sent[-1][1])
        call("/tg", msg("игра " + other.upper()))
        self.assertIn("Теперь ты играешь", tg.sent[-1][1])
        self.assertEqual(store.get("TG#7")["game"], "other")
        self.assertIn("vorobey", store.get("GAMEUSERS#other")["users"])
        call("/tg", msg("/zagadka"))
        self.assertIn("нет ведущего", tg.sent[-1][1])                 # the other game has no host yet
        call("/tg", msg("/game", uid=9))
        self.assertIn("/start", tg.sent[-1][1])                        # not linked

    def test_auth(self):
        self.assertEqual(call("/game/stream/start", {}, "nope")[0], 401)
        r = handler.lambda_handler({"rawPath": "/tg", "headers": {"x-telegram-bot-api-secret-token": "bad"},
                                    "body": "{}"}, None)
        self.assertEqual(r["statusCode"], 403)


if __name__ == "__main__":
    unittest.main()
