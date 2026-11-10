"""The questions of the Quiz game: the platform's generated quizzes (Laravel GET /internal/guessword/quizzes?lang=..,
header X-Internal-Secret), one copy per process for every room. Fetched in a background thread at the first use and
every REFRESH_SEC; the last good copy is kept on disk ({DATA_DIR}/quiz-bank/<lang>.json), so a restart without the
platform still plays. Without PLATFORM_URL and without a saved copy (a home copy, tests) a small built-in set plays.

A quiz of the platform: {id, key, title, topic, level, questions: [{id, type, text, correct, wrong: [...]}]} - the
copy on disk stays like that. A quiz of the game (regroup): the same fields, topic = one of TOPICS."""

import json
import os
import threading
import time
import urllib.request

from ... import config

REFRESH_SEC = 6 * 3600
RETRY_SEC = 300
LEVELS = ["easy", "medium", "hard"]
LEVEL_RU = {"easy": "лёгкий уровень", "medium": "средний уровень", "hard": "сложный уровень"}
QUIZ_SIZE = 20

# A topic of the game = some question types of the factory (services/quiz-factory, question key "<type>:<Wikidata id>").
# The platform's quizzes mix the types of a whole category, so the bank deals their questions again: quizzes of one
# topic and one level. The first eight were the only topics until 2026-11-10 (then: a topic = the quiz's category).
THEMES = {
    "geography": ("География", "capital city_country heritage_country highest_point currency language"),
    "sports": ("Спорт", "olympics_summer olympics_winter wc_host wc_winner euro_host euro_winner athlete_sport stadium_city"),
    "literature": ("Литература", "book_author book_year character_work"),
    "art": ("Искусство", "painting_author painting_museum painting_year sculpture_author"),
    "movies": ("Кино", "film_director film_year film_country"),
    "music": ("Музыка", "band_country band_year opera_composer"),
    "science": ("Наука", "element_symbol nobel_field"),
    "history": ("История", "battle_year war_start treaty_year revolution_year disaster_year"),
    "mountains": ("Горы", "mountain_country elevation"),
    "waters": ("Реки, озёра, острова", "river_mouth lake_country island_country waterfall_country"),
    "athletes": ("Спортсмены", "athlete_born athlete_died athlete_country"),
    "clubs": ("Спортивные клубы", "club_city club_country club_year team_country"),
    "writers": ("Писатели", "writer_born writer_died writer_country"),
    "artists": ("Художники", "artist_born artist_died"),
    "architecture": ("Архитектура", "building_architect building_city"),
    "actors": ("Актёры", "actor_born actor_died actor_country"),
    "series": ("Сериалы", "series_year series_country"),
    "cartoons": ("Мультфильмы", "cartoon_studio"),
    "soundtracks": ("Музыка кино", "film_composer"),
    "musicians": ("Музыканты", "musician_born musician_died musician_country"),
    "albums": ("Альбомы", "album_artist album_year"),
    "songs": ("Песни", "song_artist song_year"),
    "scientists": ("Учёные", "scientist_born scientist_died scientist_country"),
    "space": ("Космос", "moon_planet star_constellation"),
    "rulers": ("Правители и политики", "politician_born politician_died"),
    "games": ("Видеоигры", "game_year game_developer game_publisher"),
    "companies": ("Компании", "company_country company_year company_founder company_city car_maker"),
    "nature": ("Животные и растения", "animal_family animal_order"),
    "food": ("Еда и напитки", "dish_country"),
    "universities": ("Университеты", "university_city university_year"),
    "languages": ("Языки", "language_script"),
}
TOPICS = list(THEMES)
OLD_TOPICS = TOPICS[:8]
TYPE_TOPIC = {t: topic for topic, (_, types) in THEMES.items() for t in types.split()}
# a question of an unknown type (a new one of the factory) plays in the topic of its quiz's category
CATEGORY_TOPIC = {**{t: t for t in TOPICS}, "video-games": "games", "technology": "companies", "food-drink": "food",
                  "general-knowledge": "universities", "language": "languages"}


def regroup(quizzes):
    """The platform's quizzes -> the game's: the questions dealt by topic (by their type) and level, QUIZ_SIZE each."""
    buckets = {}
    for quiz in quizzes:
        for q in quiz.get("questions") or []:
            topic = TYPE_TOPIC.get(q.get("type")) or CATEGORY_TOPIC.get(quiz.get("topic"))
            if topic:
                buckets.setdefault((topic, quiz.get("level")), []).append(q)
    out = []
    for (topic, level), qs in sorted(buckets.items(), key=lambda kv: (TOPICS.index(kv[0][0]), str(kv[0][1]))):
        qs.sort(key=lambda q: q["id"])
        chunks = [qs[i:i + QUIZ_SIZE] for i in range(0, len(qs), QUIZ_SIZE)]
        if len(chunks) > 1 and len(chunks[-1]) < QUIZ_SIZE // 2:      # a short tail joins the quiz before it
            chunks[-2:] = [chunks[-2] + chunks[-1]]
        for n, chunk in enumerate(chunks, 1):
            key = f"{topic}-{level or 'mix'}-{n}"
            title = THEMES[topic][0] + (f": {LEVEL_RU[level]}" if level in LEVEL_RU else "") + f" — №{n}"
            out.append({"id": key, "key": key, "title": title, "topic": topic, "level": level, "questions": chunk})
    return out

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
                        raw = json.load(f)
                    self.data[lang] = regroup(raw)
                    # a copy saved before 2026-11-10 has no question types: it plays by category until the fetch
                    typed = any(x.get("type") for q in raw for x in q.get("questions") or [])
                    self.fetched[lang] = os.path.getmtime(self._file(lang)) if typed else 1
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
                self.data[lang] = regroup(quizzes)
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
