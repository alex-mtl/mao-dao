// New questions in portions, resumable: node batch.mjs [--size=5000] [--batches=10] [--plan-only] [--dry-run]
// Each portion = data/batches/NNN.json (quizzes of 20, only NEW questions) + data/batches/NNN.done (quiz keys already
// imported, one per line). A crash or a network delay costs nothing: a re-run imports what is left of the planned
// portions first, then plans the next ones until --batches portions exist. Questions already on the site
// (data/existing.json) or in any quiz (data/assignments.json, batch files) are never taken again; their quizzes stay.
// Rules as in plan.mjs: one category + one level per quiz, types mixed, one correct answer at most 6 times per type for
// people (40 otherwise), duplicate question texts dropped. Level = fame rank inside the type over ALL its candidates
// (stable between portions), 30% easy, 40% medium, 30% hard; every portion takes the levels of a type in turn 3:4:3.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { build as geo } from './build-geo.mjs';
import { build as sport } from './build-sport.mjs';
import { build as culture } from './build-culture.mjs';
import { build as science } from './build-science.mjs';
import { build as history } from './build-history.mjs';
import { build as people } from './build-people.mjs';
import { build as more } from './build-more.mjs';
import { POOL, norm } from './lib/common.mjs';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=')[1];
const SIZE = Number(arg('size', 5000));
const BATCHES = Number(arg('batches', 10));
const PLAN_ONLY = process.argv.includes('--plan-only');
const DRY = process.argv.includes('--dry-run');
const DIR = 'data/batches';
const QUIZ = 20;
mkdirSync(DIR, { recursive: true });

export const CATEGORY = {
  geography: ['География', 'geo'], sports: ['Спорт', 'sport'], literature: ['Литература', 'lit'], art: ['Искусство', 'art'],
  movies: ['Кино', 'film'], music: ['Музыка', 'music'], science: ['Наука', 'sci'], history: ['История', 'hist'],
  'video-games': ['Видеоигры', 'games'], technology: ['Техника и компании', 'tech'], nature: ['Природа', 'nature'],
  'food-drink': ['Еда и напитки', 'food'], 'general-knowledge': ['Эрудиция', 'gk'], language: ['Языки', 'lang'],
};
const LEVEL = { easy: 'лёгкий уровень', medium: 'средний уровень', hard: 'сложный уровень' };
// a category with fewer candidates than this (Еда и напитки, Языки) gets quizzes of mixed level, one bucket instead of three
const SMALL = 600;
export const TOPIC = {
  capital: 'столицы', city_country: 'города', mountain_country: 'горы', elevation: 'высоты гор', highest_point: 'высшие точки стран',
  river_mouth: 'реки', currency: 'валюты', language: 'языки', olympics_summer: 'летние Олимпиады', olympics_winter: 'зимние Олимпиады',
  wc_host: 'чемпионаты мира', wc_winner: 'чемпионы мира', euro_host: 'чемпионаты Европы', euro_winner: 'чемпионы Европы',
  athlete_sport: 'звёзды спорта', club_country: 'футбольные клубы', book_author: 'авторы книг', painting_author: 'художники',
  painting_museum: 'музеи', film_director: 'режиссёры', film_year: 'годы выхода фильмов', opera_composer: 'оперы',
  band_country: 'группы', element_symbol: 'химические элементы', nobel_field: 'Нобелевские премии',
  battle_year: 'сражения', war_start: 'войны',
  // 2026-11-09
  politician_born: 'годы рождения правителей и политиков', politician_died: 'годы смерти правителей и политиков',
  scientist_born: 'годы рождения учёных', scientist_died: 'годы смерти учёных', scientist_country: 'учёные и их страны',
  artist_born: 'годы рождения художников и архитекторов', artist_died: 'годы смерти художников и архитекторов',
  musician_born: 'годы рождения музыкантов', musician_died: 'годы смерти музыкантов', musician_country: 'музыканты и их страны',
  actor_born: 'годы рождения актёров', actor_died: 'годы смерти актёров', actor_country: 'актёры и их страны',
  writer_born: 'годы рождения писателей', writer_died: 'годы смерти писателей', writer_country: 'писатели и их страны',
  athlete_born: 'годы рождения спортсменов', athlete_died: 'годы смерти спортсменов', athlete_country: 'спортсмены и их страны',
  island_country: 'острова', lake_country: 'озёра', waterfall_country: 'водопады', heritage_country: 'объекты ЮНЕСКО',
  building_city: 'знаменитые здания', building_architect: 'архитекторы', painting_year: 'годы картин', sculpture_author: 'скульптуры',
  book_year: 'годы публикации книг', character_work: 'литературные герои', film_country: 'страны фильмов',
  film_composer: 'музыка к фильмам', series_year: 'годы выхода сериалов', series_country: 'страны сериалов',
  cartoon_studio: 'мультфильмы', album_artist: 'альбомы', album_year: 'годы выхода альбомов', song_artist: 'песни',
  song_year: 'годы выхода песен', band_year: 'годы основания групп', game_year: 'годы выхода игр', game_developer: 'разработчики игр',
  game_publisher: 'издатели игр', company_country: 'страны компаний', company_year: 'годы основания компаний',
  company_founder: 'основатели компаний', company_city: 'штаб-квартиры компаний', car_maker: 'автомобили',
  moon_planet: 'спутники планет', star_constellation: 'звёзды и созвездия', animal_family: 'семейства животных и растений',
  animal_order: 'отряды животных и растений', dish_country: 'блюда и напитки народов мира', treaty_year: 'договоры',
  revolution_year: 'революции и восстания', disaster_year: 'катастрофы', club_year: 'годы основания клубов', club_city: 'города клубов',
  team_country: 'хоккейные и баскетбольные клубы', stadium_city: 'стадионы', university_city: 'университеты',
  university_year: 'годы основания университетов', language_script: 'письменность языков',
};
const PERSON_TYPES = new Set(['book_author', 'painting_author', 'film_director', 'opera_composer', 'painting_museum',
  'building_architect', 'sculpture_author', 'film_composer', 'company_founder', 'album_artist', 'song_artist', 'character_work']);
const perAnswer = (type) => (PERSON_TYPES.has(type) ? 6 : 40);
const pad = (n) => String(n).padStart(3, '0');
const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const batchFiles = () => readdirSync(DIR).filter((f) => /^\d{3}\.json$/.test(f)).sort();

// --- 1. all candidates (Wikidata answers are cached in data/cache, so a re-run is fast)
let all = null;
async function candidates() {
  if (all) return all;
  all = [];
  for (const [name, fn] of [['geo', geo], ['sport', sport], ['culture', culture], ['science', science], ['history', history], ['people', people], ['more', more]]) {
    const d = await fn();
    console.log(name, d.length);
    all.push(...d);
  }
  const textCount = new Map();
  for (const d of all) textCount.set(norm(d.text), (textCount.get(norm(d.text)) ?? 0) + 1);
  all = all.filter((d) => textCount.get(norm(d.text)) === 1);
  for (const t of Object.values(Object.groupBy(all, (d) => d.type))) { // stable level: rank among all candidates of the type
    t.sort((a, b) => b.popularity - a.popularity);
    t.forEach((d, i) => { d.level = i < t.length * 0.3 ? 'easy' : i < t.length * 0.7 ? 'medium' : 'hard'; });
  }
  console.log('candidates', all.length);
  return all;
}

// --- 2. plan one portion
async function plan(n) {
  const cands = await candidates();
  const assignFile = 'data/assignments.json';
  const assignments = readJson(assignFile, {});
  const taken = new Set([...readJson('data/existing.json', []).map((e) => e.key), ...Object.keys(assignments)]);
  const byId = new Map(cands.map((d) => [d.id, d]));
  // answers already used per type count against the limit
  const used = new Map();
  for (const id of taken) {
    const d = byId.get(id);
    if (!d) continue;
    const k = `${d.type}|${norm(d.group ?? d.correct)}`;
    used.set(k, (used.get(k) ?? 0) + 1);
  }
  // per type: levels in turn 3:4:3, each in fame order, answers within the limit
  const queueOf = (qs) => {
    const seen = new Map(used);
    const ok = qs.sort((a, b) => b.popularity - a.popularity).filter((d) => {
      const k = `${d.type}|${norm(d.group ?? d.correct)}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      return seen.get(k) <= perAnswer(d.type);
    });
    const lv = { easy: ok.filter((d) => d.level === 'easy'), medium: ok.filter((d) => d.level === 'medium'), hard: ok.filter((d) => d.level === 'hard') };
    const out = [];
    const turn = ['easy', 'medium', 'hard', 'medium', 'easy', 'medium', 'hard', 'easy', 'medium', 'hard'];
    for (let i = 0; Object.values(lv).some((x) => x.length); i++) { const l = lv[turn[i % 10]]; if (l.length) out.push(l.shift()); }
    return out;
  };
  const free = cands.filter((d) => !taken.has(d.id));
  const byCat = Object.groupBy(free, (d) => d.category);
  const queues = Object.fromEntries(Object.entries(byCat).map(([c, qs]) => [c, Object.values(Object.groupBy(qs, (d) => d.type)).map(queueOf)]));
  const avail = Object.fromEntries(Object.entries(queues).map(([c, qs]) => [c, qs.reduce((s, q) => s + q.length, 0)]));
  const totalAvail = Object.values(avail).reduce((s, x) => s + x, 0);
  if (totalAvail < QUIZ * 3) return null;

  const quizzes = [];
  const stats = {};
  for (const [cat, [catRu, prefix]] of Object.entries(CATEGORY)) {
    if (!queues[cat]) continue;
    // share of the portion = share of what is left; a little more so that full quizzes of 20 still make SIZE
    const small = avail[cat] < SMALL;
    const want = small ? Math.min(avail[cat], QUIZ * 2) : Math.round(SIZE * avail[cat] / totalAvail) + QUIZ;
    const chosen = [];
    const qs = queues[cat];
    while (chosen.length < want && qs.some((q) => q.length)) for (const q of qs) if (q.length && chosen.length < want) chosen.push(q.shift());
    stats[cat] = { left: avail[cat] };
    for (const level of small ? ['mix'] : Object.keys(LEVEL)) {
      const lv = Object.values(Object.groupBy(chosen.filter((d) => small || d.level === level), (d) => d.type)).map((x) => [...x]);
      const mixed = [];
      while (lv.some((q) => q.length)) for (const q of lv) if (q.length) mixed.push(q.shift());
      const usable = mixed.slice(0, Math.floor(mixed.length / QUIZ) * QUIZ);
      const pre = `${prefix}-${level}-`;
      let num = Math.max(0, ...Object.values(assignments).filter((k) => k.startsWith(pre)).map((k) => +k.slice(pre.length)));
      for (let i = 0; i < usable.length; i += QUIZ) {
        const chunk = usable.slice(i, i + QUIZ);
        const key = `${pre}${++num}`;
        const topics = [...new Set(chunk.map((d) => TOPIC[d.type] ?? d.type))];
        quizzes.push({ key, title: small ? `${catRu} — №${num}` : `${catRu}: ${LEVEL[level]} — №${num}`, tag: cat, batch: n,
          description: `20 вопросов: ${topics.join(', ')}. Факты из Wikidata.`,
          questions: chunk.map((d) => ({ key: d.id, text: d.text, correct: d.correct, wrong: d.wrong.slice(0, POOL) })) });
        for (const d of chunk) assignments[d.id] = key;
      }
      stats[cat][level] = usable.length;
    }
  }
  // the portion file first, then the assignments (a crash in between is repaired by syncAssignments)
  writeFileSync(join(DIR, `${pad(n)}.json`), JSON.stringify(quizzes, null, 1));
  writeFileSync(assignFile, JSON.stringify(assignments, null, 1));
  console.table(stats);
  console.log(`portion ${pad(n)}: ${quizzes.length} quizzes, ${quizzes.length * QUIZ} questions`);
  return quizzes;
}

/** every question of a portion file is in data/assignments.json (repairs a crash between the two writes) */
function syncAssignments() {
  const f = 'data/assignments.json';
  const a = readJson(f, {});
  let fixed = 0;
  for (const b of batchFiles()) for (const q of readJson(join(DIR, b), [])) for (const x of q.questions) if (a[x.key] !== q.key) { a[x.key] = q.key; fixed++; }
  if (fixed) { writeFileSync(f, JSON.stringify(a, null, 1)); console.log('assignments repaired', fixed); }
}

// --- 3. import one portion, quiz by quiz; the .done file remembers what went through
const secretFile = join(homedir(), '.mao-dao', 'quiz-import-secret');
const SECRET = process.env.QUIZ_IMPORT_SECRET || (existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : '');
const URL_BASE = process.env.QUIZ_IMPORT_URL || 'https://mao-dao.com';
async function post(body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${URL_BASE}/internal/quizzes/import`, { method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Internal-Secret': SECRET }, body: JSON.stringify(body) });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`${body.key}: ${res.status} ${text.slice(0, 600)}`), { fatal: true });
      throw new Error(`${res.status}`);
    } catch (e) {
      if (e.fatal || attempt >= 8) throw e;
      const wait = Math.min(300, 10 * 2 ** (attempt - 1));
      console.log(`${body.key}: ${e.message}, again in ${wait} s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}
async function importBatch(n) {
  const quizzes = readJson(join(DIR, `${pad(n)}.json`), []);
  const doneFile = join(DIR, `${pad(n)}.done`);
  const done = new Set(existsSync(doneFile) ? readFileSync(doneFile, 'utf8').split('\n').filter(Boolean) : []);
  const left = quizzes.filter((q) => !done.has(q.key));
  if (!left.length) return;
  if (!SECRET) throw new Error('no QUIZ_IMPORT_SECRET');
  console.log(`portion ${pad(n)}: importing ${left.length} of ${quizzes.length} quizzes`);
  const total = { added: 0, updated: 0, skipped: 0 };
  for (const [i, quiz] of left.entries()) {
    const r = await post({ key: quiz.key, title: quiz.title, description: quiz.description, language: 'ru', tags: [quiz.tag], status: 'published',
      questions: quiz.questions.map((q) => ({ key: q.key, text: q.text, wrong_pool: q.wrong,
        answers: [{ text: q.correct, is_correct: true }, ...q.wrong.slice(0, 3).map((t) => ({ text: t, is_correct: false }))] })) });
    for (const k of Object.keys(total)) total[k] += r[k];
    appendFileSync(doneFile, quiz.key + '\n');
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${left.length}, +${total.added}`);
  }
  console.log(`portion ${pad(n)} imported`, total);
}

// --- run: finish what is planned, then plan and import new portions
syncAssignments();
for (let n = 1; n <= BATCHES; n++) {
  if (!existsSync(join(DIR, `${pad(n)}.json`)) && !(await plan(n))) { console.log('no more candidates'); break; }
  if (!PLAN_ONLY && !DRY) await importBatch(n);
}
console.log('done');
