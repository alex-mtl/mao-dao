"""The questions of the Quiz game: the platform's generated quizzes (Laravel GET /internal/guessword/quizzes?lang=..,
header X-Internal-Secret), one copy per process for every room. Fetched in a background thread at the first use and
every REFRESH_SEC; the last good copy is kept on disk ({DATA_DIR}/quiz-bank/<lang>.json), so a restart without the
platform still plays. Without PLATFORM_URL and without a saved copy (a home copy, tests) a small built-in set plays.

A quiz: {id, key, title, topic, level, questions: [{id, text, correct, wrong: [...]}]}."""

import json
import os
import threading
import time
import urllib.request

from ... import config

REFRESH_SEC = 6 * 3600
RETRY_SEC = 300
TOPICS = ["geography", "sports", "literature", "art", "movies", "music", "science", "history"]
LEVELS = ["easy", "medium", "hard"]

SAMPLE = {"ru": [
    {"id": -1, "key": "sample-geography-easy-1", "title": "География: пример", "topic": "geography", "level": "easy", "questions": [
        {"id": -101, "text": "Столица Австралии?", "correct": "Канберра",
         "wrong": ["Сидней", "Мельбурн", "Брисбен", "Перт", "Аделаида", "Дарвин", "Хобарт"]},
        {"id": -102, "text": "Столица Канады?", "correct": "Оттава",
         "wrong": ["Торонто", "Монреаль", "Ванкувер", "Калгари", "Эдмонтон", "Квебек"]},
        {"id": -103, "text": "Куда впадает Ока?", "correct": "Волга",
         "wrong": ["Дон", "Кама", "Днепр", "Москва", "Клязьма", "Десна"]},
        {"id": -104, "text": "Валюта Японии?", "correct": "Иена",
         "wrong": ["Юань", "Вона", "Бат", "Рупия", "Ринггит", "Донг"]},
        {"id": -105, "text": "Столица Турции?", "correct": "Анкара",
         "wrong": ["Стамбул", "Измир", "Бурса", "Анталья", "Рим", "Париж"]},
        {"id": -106, "text": "Столица Бразилии?", "correct": "Бразилиа",
         "wrong": ["Рио-де-Жанейро", "Сан-Паулу", "Сальвадор", "Ресифи", "Белен"]},
    ]},
    {"id": -2, "key": "sample-movies-easy-1", "title": "Кино: пример", "topic": "movies", "level": "easy", "questions": [
        {"id": -201, "text": "Режиссёр фильма «Титаник»?", "correct": "Джеймс Кэмерон",
         "wrong": ["Стивен Спилберг", "Кристофер Нолан", "Мартин Скорсезе", "Ридли Скотт"]},
        {"id": -202, "text": "Режиссёр фильма «Сталкер»?", "correct": "Андрей Тарковский",
         "wrong": ["Никита Михалков", "Эльдар Рязанов", "Леонид Гайдай", "Георгий Данелия"]},
        {"id": -203, "text": "Режиссёр фильма «Начало»?", "correct": "Кристофер Нолан",
         "wrong": ["Джеймс Кэмерон", "Дэвид Финчер", "Ридли Скотт", "Стивен Спилберг"]},
        {"id": -204, "text": "Режиссёр фильма «Бриллиантовая рука»?", "correct": "Леонид Гайдай",
         "wrong": ["Эльдар Рязанов", "Георгий Данелия", "Владимир Меньшов", "Никита Михалков"]},
        {"id": -205, "text": "Режиссёр фильма «Криминальное чтиво»?", "correct": "Квентин Тарантино",
         "wrong": ["Мартин Скорсезе", "Роберт Родригес", "Дэвид Финчер", "Гай Ричи"]},
    ]},
]}


class QuizBank:
    def __init__(self):
        self.data = {}                  # lang -> [quiz]
        self.fetched = {}               # lang -> time of the last good fetch (or of the copy on disk)
        self.tried = {}                 # lang -> time of the last attempt
        self.busy = set()
        self.lock = threading.Lock()

    def _file(self, lang):
        return os.path.join(config.DATA_DIR, "quiz-bank", f"{lang}.json")

    def quizzes(self, lang):
        """The quizzes of a language now (never waits for the network)."""
        with self.lock:
            if lang not in self.data:
                try:
                    with open(self._file(lang), encoding="utf-8") as f:
                        self.data[lang] = json.load(f)
                    self.fetched[lang] = os.path.getmtime(self._file(lang))
                except (OSError, ValueError):
                    self.data[lang] = []
            now = time.time()
            stale = now - self.fetched.get(lang, 0) > REFRESH_SEC and now - self.tried.get(lang, 0) > RETRY_SEC
            if config.PLATFORM_URL and stale and lang not in self.busy:
                self.busy.add(lang)
                self.tried[lang] = now
                threading.Thread(target=self._fetch, args=(lang,), daemon=True).start()
            out = self.data[lang]
        return out or ([] if config.PLATFORM_URL and self.fetched.get(lang) else SAMPLE.get(lang, []))

    def _fetch(self, lang):
        try:
            req = urllib.request.Request(f"{config.PLATFORM_URL}/internal/guessword/quizzes?lang={lang}",
                                         headers={"X-Internal-Secret": config.INTERNAL_SECRET, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                quizzes = json.loads(r.read().decode("utf-8"))["quizzes"]
            quizzes = [q for q in quizzes if q.get("topic") and q.get("questions")]
            os.makedirs(os.path.dirname(self._file(lang)), exist_ok=True)
            tmp = self._file(lang) + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(quizzes, f, ensure_ascii=False)
            os.replace(tmp, self._file(lang))
            with self.lock:
                self.data[lang] = quizzes
                self.fetched[lang] = time.time()
            print(f"[quiz] bank {lang}: {len(quizzes)} quizzes, {sum(len(q['questions']) for q in quizzes)} questions")
        except Exception as e:
            print(f"[quiz] bank {lang}: can't fetch ({type(e).__name__}: {e})")
        finally:
            with self.lock:
                self.busy.discard(lang)


_bank = QuizBank()


def bank():
    return _bank
