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
        tg.later.clear()
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

    def test_link_up_moves_a_linked_viewer_here(self):
        self.host_and_viewer()
        self.assertEqual(call("/game/switch", {"tiktok_id": "nobody"}, self.key)[1], {"ok": True, "linked": False})
        r = call("/game/switch", {"tiktok_id": "Vorobey"}, self.key)[1]
        self.assertEqual((r["linked"], r["switched"]), (True, False))      # this game already
        link = store.get("TT#vorobey")
        store.put("TT#vorobey", dict(link, game="other"))
        store.put("TG#7", dict(link, game="other"))
        tg.sent.clear()
        r = call("/game/switch", {"tiktok_id": "vorobey"}, self.key)[1]
        self.assertTrue(r["switched"])
        self.assertEqual(store.get("TG#7")["game"], link["game"])
        self.assertEqual(tg.sent[-1][0], 7)                                 # told in the messenger

    def test_links_for_the_room_page(self):
        self.host_and_viewer()
        self.assertNotIn("links", self.poll())                         # only when the game asks
        self.assertEqual(self.poll({"want_links": True})["links"]["vorobey"]["id"], "7")

    def test_host_picks_viewer(self):
        call("/tg", msg("загадывает", uid=5))
        self.assertIn("только для ведущего", tg.sent[-1][1])
        self.host_and_viewer()
        self.assertIn((5, {"commands": ["start", "help", "zagadka", "hints", "game", "pick", "queue", "round", "history"]}),
                      tg.markups)
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
        self.assertEqual(self.poll(), {"words": [], "cancel": [], "requests": []})     # given once
        self.poll({"results": [{"id": wid, "stage": "check", "ok": False}]})
        self.assertIn("нет в словаре", tg.sent[-2][1])                 # the player: stays
        self.assertIn("не найдено", tg.sent[-1][1])
        self.assertEqual((tg.temp[-1][0], tg.temp[-1][2]), (5, 30))    # the host: gone after 30 s
        month = __import__("time").strftime("%Y-%m", __import__("time").gmtime())
        missing = store.get(f"MISSING#mao#{month}")["words"]
        self.assertEqual((missing[-1]["word"], missing[-1]["tt"]), ("Огурцы", "vorobey"))
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
        self.assertEqual(self.poll(), {"words": [], "cancel": [], "requests": []})     # never reached the game
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
        self.poll({"queue_ids": [wid]})                               # still in the game's queue: kept
        call("/tg", msg("/queue", uid=5))
        self.assertIn("ОГУРЕЦ", tg.temp[-1][1])
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

    def test_queue_follows_the_game(self):
        self.host_and_viewer()
        call("/tg", msg("/zagadka"))
        call("/tg", msg("огурец"))
        wid = self.poll()["words"][0]["id"]
        self.poll({"results": [{"id": wid, "stage": "check", "ok": True, "word": "огурец"}]})
        self.cb("ok:" + wid)
        self.poll()
        self.poll({"results": [{"id": wid, "stage": "queue", "ok": True, "round": 8}]})
        self.poll({"queue_ids": []})                                  # the "played" report was lost in a restart
        call("/tg", msg("/queue", uid=5))
        self.assertIn("пуста", tg.temp[-1][1])

    def test_unguessed_word_saved_and_hints(self):
        call("/tg", msg("/hints", uid=8))
        self.assertIn("/start", tg.sent[-1][1])                        # not linked
        self.host_and_viewer()
        call("/tg", msg("мои подсказки"))
        self.assertIn("<b>0</b> подсказок", tg.sent[-1][1])
        self.poll({"credits": {"Vorobey": 1}, "unguessed": [{"id": "x", "tiktok_id": "vorobey", "word": "огурец",
                                                             "lang": "ru"}]})
        self.assertEqual(tg.sent[-1][0], 7)
        self.assertIn("никто не угадал", tg.sent[-1][1])
        call("/tg", msg("/hints"))
        self.assertIn("<b>1</b> подсказка", tg.sent[-1][1])
        self.poll({"credits": {"vorobey": 3}})
        call("/tg", msg("подсказки"))
        self.assertIn("<b>3</b> подсказки", tg.sent[-1][1])
        tg.markups.clear()
        call("/tg", msg("/zagadka"))                                   # the saved word is offered + "new"
        kb = tg.markups[-1][1]["inline_keyboard"]
        self.assertEqual([r[0]["callback_data"] for r in kb], ["use:огурец", "new"])
        vcb = lambda data: call("/tg", {"callback_query": {"id": "v", "from": {"id": 7}, "data": data,
                                                           "message": {"chat": {"id": 7}, "message_id": 9}}})
        vcb("new")
        self.assertIn("Пришли новое слово", tg.sent[-1][1])
        vcb("use:огурец")
        self.assertIn("Проверяю", tg.sent[-1][1])
        self.assertEqual(store.get("SAVED#vorobey")["words"], [])     # taken from the saved ones
        vcb("use:огурец")
        self.assertIn("ждёт", tg.sent[-1][1])                          # pressed twice
        wid = self.poll()["words"][0]["id"]
        self.poll({"results": [{"id": wid, "stage": "check", "ok": True, "word": "огурец"}]})
        self.cb("rej:" + wid)
        self.assertEqual([w["word"] for w in store.get("SAVED#vorobey")["words"]], ["огурец"])   # back again

    def test_nickname_changes(self):
        self.host_and_viewer()
        call("/tg", msg("/zagadka"))
        call("/tg", msg("огурец"))
        r = self.poll({"names": {"Vorobey": "Соловей", "someone": "Кто-то"}})
        self.assertEqual(store.get("GAMEUSERS#mao")["users"]["vorobey"]["name"], "Соловей")
        self.assertEqual(store.get("TT#vorobey")["tiktok_name"], "Соловей")
        self.assertEqual(store.get("TG#7")["tiktok_name"], "Соловей")
        self.assertNotIn("someone", store.get("GAMEUSERS#mao")["users"])   # not linked: not stored
        self.assertEqual(r["words"][0]["name"], "Соловей")              # the word on its way: new name

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

    def test_platform_registers_rooms(self):
        tg._params["platform-secret"] = "plat"
        post = lambda body, secret="plat": handler.lambda_handler(
            {"rawPath": "/platform/games", "headers": {"X-Platform-Secret": secret}, "body": json.dumps(body)}, None)
        self.assertEqual(post({"id": "gw5"}, secret="nope")["statusCode"], 403)
        self.assertEqual(post({"id": "../x"})["statusCode"], 400)
        r = json.loads(post({"id": "gw5", "lang": "en"})["body"])
        self.assertEqual(r["id"], "gw5")
        k1 = r["game_key"]
        code, s1 = call("/game/stream/start", {"tiktok": "streamer"}, k1)    # the key works for the game API
        self.assertEqual(code, 200)
        k2 = json.loads(post({"id": "gw5"})["body"])["game_key"]           # again: a new key, the old one is dead
        self.assertNotEqual(k1, k2)
        self.assertEqual(call("/game/stream/start", {}, k1)[0], 401)
        self.assertEqual(call("/game/stream/start", {}, k2)[0], 200)

    def test_twin_games_on_one_live(self):
        call("/tg", {"message": {"chat": {"id": 9}, "from": {"id": 9, "username": "Boss"}, "text": "привет"}})
        handler.admin({"action": "set_superadmin", "username": "boss"})
        tg.sent.clear()
        call("/game/stream/start", {"tiktok": "@Mao.Montreal"}, self.key)
        self.assertEqual(tg.sent, [])                                   # one game: fine
        call("/game/stream/start", {"tiktok": "mao.montreal"}, self.key)
        self.assertEqual(tg.sent, [])                                   # its own restart: fine
        call("/game/stream/start", {"tiktok": "mao.montreal"}, self.key2)
        self.assertEqual(tg.sent[-1][0], 9)
        self.assertIn("подключён к двум играм", tg.sent[-1][1])
        n = len(tg.sent)
        call("/game/stream/start", {"tiktok": "mao.montreal"}, self.key)
        self.assertEqual(len(tg.sent), n)                               # not again within half an hour

    def test_same_game_running_twice(self):
        call("/tg", {"message": {"chat": {"id": 9}, "from": {"id": 9, "username": "Boss"}, "text": "привет"}})
        handler.admin({"action": "set_superadmin", "username": "boss"})
        tg.sent.clear()
        poll = lambda inst: call("/game/poll", {"v": 2, "instance": inst}, self.key)
        poll("A"); poll("A")
        poll("B")                                                       # a restart: A never polls again
        poll("B")
        self.assertEqual(tg.sent, [])
        poll("A")                                                       # ...but A is still alive: a twin
        self.assertIn("запущена дважды", tg.sent[-1][1])

    def test_lone_game_writes_its_mark_rarely(self):
        writes = []
        real = store.table().put
        store.table().put = lambda item: (writes.append(item["pk"]), real(item))
        for _ in range(5):
            call("/game/poll", {"v": 2, "instance": "A"}, self.key)
        self.assertEqual(writes.count("INST#mao"), 1)                  # 5 polls, one write

    def test_floats_go_to_dynamodb_as_decimals(self):
        from decimal import Decimal
        put = []

        class T:
            def put_item(self, Item, **kw): put.append(Item)
        store.DynamoTable(T()).put({"pk": "x", "seen": {"a": {"at": 1.5, "first": 2}}, "l": [0.25]})
        self.assertEqual(put[0]["seen"]["a"]["at"], Decimal("1.5"))
        self.assertEqual(put[0]["l"], [Decimal("0.25")])
        self.assertEqual(store._plain(put[0])["seen"]["a"]["at"], 1.5)

    def test_auth(self):
        self.assertEqual(call("/game/stream/start", {}, "nope")[0], 401)
        r = handler.lambda_handler({"rawPath": "/tg", "headers": {"x-telegram-bot-api-secret-token": "bad"},
                                    "body": "{}"}, None)
        self.assertEqual(r["statusCode"], 403)


if __name__ == "__main__":
    unittest.main()


class ReportsTest:
    """The host's /round and /history: the bot leaves a request, the game answers on its next poll."""

    def test_round_report(self):
        call("/tg", msg("/round", uid=5))
        self.assertIn("только для ведущего", tg.sent[-1][1])
        self.host_and_viewer()
        self.poll({"instance": "i1"})                                # the game is on air (it polls)
        call("/tg", msg("раунд", uid=5))
        self.assertIn("Спрашиваю игру", tg.temp[-1][1])
        reqs = self.poll()["requests"]
        self.assertEqual([(r["type"], r["n"]) for r in reqs], [("round", 1)])
        data = {"round": 7, "phase": "playing", "word": "КОЛЕСО", "setter": "ANESYA", "seconds": 125,
                "players": 2, "guesses": 9, "who": [["Нина", 3, 5], ["Tati", 0, 4]],
                "top": [["РУЛЬ", 3, "Нина"], ["ДОРОГА", 40, "Tati"]]}
        self.poll({"answers": [{"id": reqs[0]["id"], "type": "round", "data": data}]})
        text = tg.sent[-1][1]
        self.assertEqual(tg.sent[-1][0], 5)
        for part in ("Раунд 7", "КОЛЕСО", "ANESYA", "2:05", "Нина — #3 · 5", "Tati — — · 4", "<b>РУЛЬ</b> #3 — Нина"):
            self.assertIn(part, text)
        self.assertEqual(self.poll()["requests"], [])                 # answered: not asked again

    def test_history_report(self):
        self.host_and_viewer()
        self.poll({"instance": "i1"})
        call("/tg", msg("/history 3", uid=5))
        req = self.poll()["requests"][0]
        self.assertEqual((req["type"], req["n"]), ("history", 3))
        rounds = [{"round": 6, "word": "дорога", "setter": None, "winner": "Krestik", "players": 5, "guesses": 40,
                   "seconds": 300, "winner_words": [["ПУТЬ", 12], ["ДОРОГА", 1]], "top": [["ДОРОГА", 1, "Krestik"]]},
                  {"round": 5, "word": "фрустрация", "setter": "ANESYA", "winner": None, "players": 8, "guesses": 90,
                   "seconds": 1200, "winner_words": [], "top": None}]
        n = len(tg.sent)
        self.poll({"answers": [{"id": req["id"], "type": "history", "data": rounds}]})
        self.assertEqual(len(tg.sent) - n, 2)                         # one message per round
        self.assertIn("Krestik", tg.sent[-2][1])
        self.assertIn("ПУТЬ #12", tg.sent[-2][1])
        self.assertIn("никто не угадал", tg.sent[-1][1])
        self.assertIn("не сохранён", tg.sent[-1][1])

    def test_offline_game(self):
        self.host_and_viewer()                                        # host linked, but the game never polled
        call("/tg", msg("/round", uid=5))
        self.assertIn("не на связи", tg.sent[-1][1])


    def test_dialog_steps_go_after_the_next_message(self):
        self.host_and_viewer()
        call("/tg", msg("/zagadka"))                                  # the prompt: transient
        prompt = len(tg.sent)
        self.assertEqual(tg.later, [])
        m = msg("огурец"); m["message"]["message_id"] = 501       # the viewer's word: transient too
        call("/tg", m)
        self.assertIn("Проверяю", tg.sent[-1][1])
        checking = len(tg.sent)
        # the word replaced the prompt, then "checking" replaced the word: both go in 20 s
        self.assertEqual(tg.later, [(7, [prompt], 20), (7, [501], 20)])
        wid = self.poll()["words"][0]["id"]
        self.poll({"results": [{"id": wid, "stage": "check", "ok": True, "word": "огурец"}]})
        self.assertIn("есть в словаре", [t for c, t in tg.sent if c == 7][-1])
        self.assertEqual(tg.later[-1], (7, [checking], 20))
        checked = max(i + 1 for i, (c, t) in enumerate(tg.sent) if c == 7)
        self.cb("ok:" + wid)
        self.poll()
        self.poll({"results": [{"id": wid, "stage": "queue", "ok": True, "round": 8}]})
        self.assertIn("принял", [t for c, t in tg.sent if c == 7][-1])  # stays
        self.assertEqual(tg.later[-1], (7, [checked], 20))             # "in the dictionary" goes

for _name, _test in list(vars(ReportsTest).items()):     # the reports' tests run in BotTest (its setUp and helpers)
    if _name.startswith("test_"):
        setattr(BotTest, _name, _test)
