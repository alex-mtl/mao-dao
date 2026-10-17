import json
import unittest

from bot import handler, store, tg


def call(path, body, key=None):
    headers = {"Authorization": "Bearer " + key} if key else {"X-Telegram-Bot-Api-Secret-Token": "s"}
    r = handler.lambda_handler({"rawPath": path, "headers": headers, "body": json.dumps(body)}, None)
    return r["statusCode"], json.loads(r["body"])


def msg(text, uid=7):
    return {"message": {"chat": {"id": uid}, "from": {"id": uid, "username": "vasya"}, "text": text}}


class BotTest(unittest.TestCase):
    def setUp(self):
        store.use(store.MemoryTable())
        tg.sent = []
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
        self.assertIn("Готово", tg.sent[-1][1])
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

    def test_auth(self):
        self.assertEqual(call("/game/stream/start", {}, "nope")[0], 401)
        r = handler.lambda_handler({"rawPath": "/tg", "headers": {"x-telegram-bot-api-secret-token": "bad"},
                                    "body": "{}"}, None)
        self.assertEqual(r["statusCode"], 403)


if __name__ == "__main__":
    unittest.main()
