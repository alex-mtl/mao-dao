// All builders -> quizzes of 20 for mao-dao: node plan.mjs [--target=5600] [--out=data/plan.json]
// - difficulty by fame within a question type among the chosen ones: top 30% easy, next 40% medium, the rest hard
// - a quiz = one category + one level, question types mixed (round robin), exactly 20 questions
// - balance: one correct answer at most 6 times per type (not 30 books by Агата Кристи), no type takes over a category
// - questions already on the site (data/existing.json, exported from mao-dao) stay in their quizzes, keep their text
//   and their 3 wrong answers, which become the first 3 of the pool of 14
// - data/assignments.json remembers question -> quiz, so a re-run never reshuffles and new questions go to new quizzes
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { build as geo } from './build-geo.mjs';
import { build as sport } from './build-sport.mjs';
import { build as culture } from './build-culture.mjs';
import { build as science } from './build-science.mjs';
import { build as history } from './build-history.mjs';
import { POOL, norm } from './lib/common.mjs';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=')[1];
const TARGET = Number(arg('target', 5600)); // new questions
const OUT = arg('out', 'data/plan.json');
const SIZE = 20;
// one correct answer at most 6 times per type where the answer is a person (not 30 books by Агата Кристи);
// types with few possible answers by nature (6 Nobel fields, countries of clubs) get 40
const PERSON_TYPES = new Set(['book_author', 'painting_author', 'film_director', 'opera_composer', 'painting_museum']);
const perAnswer = (type) => (PERSON_TYPES.has(type) ? 6 : 40);

const CATEGORY = {
  geography: ['География', 'geo'], sports: ['Спорт', 'sport'], literature: ['Литература', 'lit'], art: ['Искусство', 'art'],
  movies: ['Кино', 'film'], music: ['Музыка', 'music'], science: ['Наука', 'sci'], history: ['История', 'hist'],
};
// share of the new questions per category
const SHARE = { geography: 0.28, sports: 0.15, literature: 0.12, art: 0.09, movies: 0.13, music: 0.07, science: 0.06, history: 0.10 };
const LEVEL = { easy: 'лёгкий уровень', medium: 'средний уровень', hard: 'сложный уровень' };
const TOPIC = {
  capital: 'столицы', city_country: 'города', mountain_country: 'горы', elevation: 'высоты гор', highest_point: 'высшие точки стран',
  river_mouth: 'реки', currency: 'валюты', language: 'языки', olympics_summer: 'летние Олимпиады', olympics_winter: 'зимние Олимпиады',
  wc_host: 'чемпионаты мира', wc_winner: 'чемпионы мира', euro_host: 'чемпионаты Европы', euro_winner: 'чемпионы Европы',
  athlete_sport: 'звёзды спорта', club_country: 'футбольные клубы', book_author: 'авторы книг', painting_author: 'художники',
  painting_museum: 'музеи', film_director: 'режиссёры', film_year: 'годы выхода фильмов', opera_composer: 'оперы',
  band_country: 'группы', element_symbol: 'химические элементы', nobel_field: 'Нобелевские премии',
  battle_year: 'сражения', war_start: 'войны',
};

const all = [];
for (const [name, fn] of [['geo', geo], ['sport', sport], ['culture', culture], ['science', science], ['history', history]]) {
  const d = await fn();
  console.log(name, d.length);
  all.push(...d);
}
// the same question text for two different things («Турецко-персидская война», «Сердце», «Динамо»): ambiguous, all copies out
const textCount = new Map();
for (const d of all) textCount.set(norm(d.text), (textCount.get(norm(d.text)) ?? 0) + 1);
const ambiguous = all.filter((d) => textCount.get(norm(d.text)) > 1).length;
all.splice(0, all.length, ...all.filter((d) => textCount.get(norm(d.text)) === 1));
console.log('ambiguous texts dropped', ambiguous);
const byId = new Map(all.map((d) => [d.id, d]));

const setLevels = (qs) => {
  for (const t of Object.values(Object.groupBy(qs, (d) => d.type))) {
    t.sort((a, b) => b.popularity - a.popularity);
    t.forEach((d, i) => { d.level = i < t.length * 0.3 ? 'easy' : i < t.length * 0.7 ? 'medium' : 'hard'; });
  }
};

// --- questions already on the site: their quiz, text and first 3 wrong answers stay
const existing = JSON.parse(readFileSync('data/existing.json', 'utf8'));
const oldPools = new Map();
for (const f of ['data/geo-final.json', 'data/sport-final.json', 'data/sport-final-2.json']) {
  if (existsSync(f)) for (const q of JSON.parse(readFileSync(f, 'utf8'))) oldPools.set(q.id, q.wrong);
}
const quizzes = new Map(); // key -> {key, title, description, tag, questions: []}
for (const e of existing) {
  const q = quizzes.get(e.quiz_key) ?? { key: e.quiz_key, title: e.quiz_title, description: e.quiz_description, tag: e.tag, questions: [] };
  quizzes.set(e.quiz_key, q);
  const fresh = byId.get(e.key);
  const more = fresh && norm(fresh.correct) === norm(e.correct) ? fresh.wrong : (oldPools.get(e.key) ?? []);
  const wrong = [...e.wrong3, ...more.filter((w) => norm(w) !== norm(e.correct) && !e.wrong3.some((x) => norm(x) === norm(w)))].slice(0, POOL);
  q.questions.push({ key: e.key, text: e.text, correct: e.correct, wrong });
}
const taken = new Set(existing.map((e) => e.key));

// --- new questions: per category share, balanced types and answers, then quizzes of 20 per level
const assignFile = 'data/assignments.json';
const assignments = existsSync(assignFile) ? JSON.parse(readFileSync(assignFile, 'utf8')) : {};
const stats = {};
for (const [cat, [catRu, prefix]] of Object.entries(CATEGORY)) {
  const pool = all.filter((d) => d.category === cat && !taken.has(d.id));
  const want = Math.round(TARGET * SHARE[cat]);
  const types = Object.groupBy(pool, (d) => d.type);
  // each type in fame order, an answer at most PER_ANSWER times; then take from the types in turn (round robin)
  const queues = Object.values(types).map((qs) => {
    const seen = new Map();
    return qs.sort((a, b) => b.popularity - a.popularity).filter((d) => {
      const k = norm(d.group ?? d.correct);
      seen.set(k, (seen.get(k) ?? 0) + 1);
      return seen.get(k) <= perAnswer(qs[0].type);
    });
  });
  const chosen = [];
  while (chosen.length < want && queues.some((q) => q.length)) for (const q of queues) if (q.length && chosen.length < want) chosen.push(q.shift());
  stats[cat] = { available: pool.length, chosen: chosen.length };
  setLevels(chosen);

  for (const level of Object.keys(LEVEL)) {
    // types mixed inside a quiz: sort by type turn, i.e. interleave the types of this level
    const lv = Object.values(Object.groupBy(chosen.filter((d) => d.level === level), (d) => d.type)).map((qs) => [...qs]);
    const mixed = [];
    while (lv.some((q) => q.length)) for (const q of lv) if (q.length) mixed.push(q.shift());
    const usable = mixed.slice(0, Math.floor(mixed.length / SIZE) * SIZE); // exactly 20 in every quiz
    const pre = `${prefix}-${level}-`;
    let n = Math.max(0, ...Object.values(assignments).filter((k) => k.startsWith(pre)).map((k) => +k.slice(pre.length)));
    for (let i = 0; i < usable.length; i += SIZE) {
      const chunk = usable.slice(i, i + SIZE);
      const key = assignments[chunk[0].id] ?? `${pre}${++n}`;
      const topics = [...new Set(chunk.map((d) => TOPIC[d.type] ?? d.type))];
      const q = quizzes.get(key) ?? { key, title: `${catRu}: ${LEVEL[level]} — №${key.slice(pre.length)}`, tag: cat,
        description: `20 вопросов: ${topics.join(', ')}. Факты из Wikidata.`, questions: [] };
      quizzes.set(key, q);
      for (const d of chunk) {
        assignments[d.id] = key;
        q.questions.push({ key: d.id, text: d.text, correct: d.correct, wrong: d.wrong.slice(0, POOL) });
      }
    }
    stats[cat][level] = usable.length;
  }
}

writeFileSync(assignFile, JSON.stringify(assignments, null, 1));
writeFileSync(OUT, JSON.stringify([...quizzes.values()], null, 1));
const newCount = [...quizzes.values()].reduce((s, q) => s + q.questions.length, 0) - existing.length;
console.table(stats);
console.log(`quizzes ${quizzes.size}, questions ${newCount + existing.length} (new ${newCount}, already on the site ${existing.length}) -> ${OUT}`);
