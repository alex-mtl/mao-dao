// More question types from Wikidata (no model), batch of 2026-11-09: export build().
// One generic rule set for all of them: a subject with a Russian article and label, exactly ONE value of the property
// (all values are counted, also those without a Russian label), the answer has a Russian label (or a real Latin name
// where that is normal: bands, studios, companies), wrong answers = answers of other questions of the same type.
//   country: «Из какой страны фильм «Амели»?»     year: «В каком году вышла игра «Tetris»?»
//   city:    «В каком городе находится Гарвардский университет?»   entity: «Чей альбом «Thriller»?»
import { sparql, ru, lbl, cap, norm, inParts, pool, goodSubject, loadStates, countryCandidatesByFreq, collector, noPatronymic,
  yearPool, oneYear, anyAnswer, YEAR_NOW } from './lib/common.mjs';

// word stems of an answer: «Большая Медведица» -> больш, медве (found in «Бета Большой Медведицы»)
const stems = (s) => norm(s).split(/[s-]+/).filter((w) => w.length >= 3).map((w) => (w.length < 4 ? w : w.slice(0, Math.max(3, Math.min(5, w.length - 2)))));
// Bayer names give the constellation away («Бета Льва»): proper star names only (Сириус, Вега, Бетельгейзе)
const GREEK = /^(Альфа|Бета|Гамма|Дельта|Эпсилон|Дзета|Эта|Тета|Йота|Каппа|Лямбда|Мю|Ню|Кси|Омикрон|Пи|Ро|Сигма|Тау|Ипсилон|Фи|Хи|Пси|Омега)s/;
const unquote = (s) => s.replace(/^[«"](.*)[»"]$/, '$1');
const wd = (s) => s.split(' ').map((q) => 'wd:' + q).join(' ');
const CITY = 'Q515 Q1637706 Q200250 Q1549591 Q5119 Q486972 Q15284';
const BUILDINGS = 'Q41176 Q16560 Q2977 Q12518 Q24398318 Q44539 Q16970 Q32815 Q11303 Q4989906 Q12280 Q23413 Q1081138 Q33506 Q57831';
const WORKS = 'Q7725634 Q8261 Q5185279 Q25379 Q49084 Q149537 Q37484';
const COMPANIES = 'Q4830453 Q6881511 Q891723 Q786820 Q46970 Q167037 Q1058914 Q210167';

// [type, category, classes, property, kind, min sitelinks, text(label), options]
// kind: country | year | city | entity (options.job = the answer's occupation, options.of = classes of the answer)
const TYPES = [
  ['island_country', 'geography', 'Q23442', 'P17', 'country', 15, (x) => `В какой стране находится ${/остров/i.test(x) ? x : 'остров ' + x}?`],
  ['lake_country', 'geography', 'Q23397', 'P17', 'country', 15, (x) => `В какой стране находится ${/озеро|водохранилище/i.test(x) ? x : 'озеро ' + x}?`],
  ['waterfall_country', 'geography', 'Q34038', 'P17', 'country', 10, (x) => `В какой стране находится ${/водопад/i.test(x) ? x : 'водопад ' + x}?`],
  ['heritage_country', 'geography', null, 'P17', 'country', 15, (x) => `В какой стране находится ${x}?`, { where: '?x wdt:P1435 wd:Q9259.' }],
  ['building_city', 'art', BUILDINGS, 'P131', 'city', 20, (x) => `В каком городе находится ${x}?`],
  ['building_architect', 'art', BUILDINGS, 'P84', 'entity', 15, (x) => `${cap(x)} — кто архитектор?`, { job: 'Q42973', person: true }],
  ['painting_year', 'art', 'Q3305213', 'P571', 'year', 10, (x) => `В каком году написана картина «${x}»?`],
  ['sculpture_author', 'art', 'Q860861 Q179700', 'P170', 'entity', 10, (x) => `Кто автор скульптуры «${x}»?`, { job: 'Q1281618', person: true }],
  ['book_year', 'literature', WORKS, 'P577', 'year', 12, (x) => `Год первой публикации «${x}»?`],
  ['character_work', 'literature', 'Q95074 Q15632617 Q3658341', 'P1441', 'entity', 20, (x) => `${x} — из какого произведения?`, { of: WORKS, quote: true }],
  ['film_country', 'movies', 'Q11424', 'P495', 'country', 25, (x) => `Из какой страны фильм «${x}»?`],
  ['film_composer', 'movies', 'Q11424', 'P86', 'entity', 25, (x) => `Кто написал музыку к фильму «${x}»?`, { job: 'Q36834', person: true }],
  ['series_year', 'movies', 'Q5398426 Q581714', 'P580', 'year', 20, (x) => `В каком году вышел сериал «${x}»?`],
  ['series_country', 'movies', 'Q5398426 Q581714', 'P495', 'country', 20, (x) => `Из какой страны сериал «${x}»?`],
  ['cartoon_studio', 'movies', 'Q202866', 'P272', 'entity', 15, (x) => `Какая студия сняла мультфильм «${x}»?`, { latin: true }],
  ['album_artist', 'music', 'Q482994', 'P175', 'entity', 20, (x) => `Чей альбом «${x}»?`, { latin: true }],
  ['album_year', 'music', 'Q482994', 'P577', 'year', 20, (x) => `В каком году вышел альбом «${x}»?`],
  ['song_artist', 'music', 'Q7366 Q134556', 'P175', 'entity', 20, (x) => `Чья песня «${x}»?`, { latin: true }],
  ['song_year', 'music', 'Q7366 Q134556', 'P577', 'year', 20, (x) => `В каком году вышла песня «${x}»?`],
  ['band_year', 'music', 'Q215380 Q5741069', 'P571', 'year', 25, (x) => `В каком году основана группа «${x}»?`],
  ['game_year', 'video-games', 'Q7889', 'P577', 'year', 15, (x) => `В каком году вышла игра «${x}»?`],
  ['game_developer', 'video-games', 'Q7889', 'P178', 'entity', 15, (x) => `Кто разработал игру «${x}»?`, { latin: true }],
  ['game_publisher', 'video-games', 'Q7889', 'P123', 'entity', 15, (x) => `Кто издал игру «${x}»?`, { latin: true }],
  ['company_country', 'technology', COMPANIES, 'P17', 'country', 25, (x) => `Из какой страны компания «${x}»?`],
  ['company_year', 'technology', COMPANIES, 'P571', 'year', 25, (x) => `В каком году основана компания «${x}»?`],
  ['company_founder', 'technology', COMPANIES, 'P112', 'entity', 25, (x) => `Кто основал компанию «${x}»?`, { person: true, human: true }],
  ['company_city', 'technology', COMPANIES, 'P159', 'city', 25, (x) => `В каком городе штаб-квартира компании «${x}»?`],
  ['moon_planet', 'science', 'Q2537', 'P397', 'entity', 10, (x) => `Спутником какой планеты является ${x}?`, { deep: true, of: 'Q634 Q3504248 Q17362350 Q128207 Q121750 Q3319 Q111 Q193 Q308 Q313 Q332 Q339 Q324 Q2 Q319' }],
  ['star_constellation', 'science', 'Q523', 'P59', 'entity', 12, (x) => `В каком созвездии находится ${/звезда/i.test(x) ? x : 'звезда ' + x}?`, { deep: true, of: 'Q8928', subject: (x) => /^[А-ЯЁа-яё -]+$/.test(x) && !GREEK.test(x) }],
  ['animal_family', 'nature', null, 'P171', 'rank', 30, (x) => `${cap(x)} — к какому семейству относится?`, { rank: 'Q35409', cyrillic: true }],
  ['animal_order', 'nature', null, 'P171', 'rank', 30, (x) => `${cap(x)} — к какому отряду относится?`, { rank: 'Q36602', cyrillic: true }],
  ['dish_country', 'food-drink', 'Q746549 Q10943 Q40050 Q134768 Q41415 Q2095 Q1334184 Q1640824 Q7802 Q44', 'P495', 'country', 15, (x) => `Из какой страны родом «${x}»?`],
  ['treaty_year', 'history', 'Q131569 Q625298 Q864737', 'P585', 'year', 15, (x) => `${cap(x)} — в каком году?`],
  ['revolution_year', 'history', 'Q10931 Q124734 Q45382 Q49773 Q1006311', 'P580', 'year', 15, (x) => `${cap(x)} — год начала?`],
  // «Землетрясение в Турции», «Наводнение на Балканах»: there were many, only named ones («Сычуаньское землетрясение»)
  ['disaster_year', 'history', 'Q7944 Q8065 Q168247 Q3839081 Q8068 Q11423 Q1190554', 'P585', 'year', 20, (x) => `${cap(x)} — в каком году?`,
    { subject: (x) => !/^(землетрясение|наводнение|извержение|цунами|пожар|ураган|катастрофа|теракт|авиакатастрофа)s+(в|на|под)s/i.test(x) }],
  ['club_year', 'sports', 'Q476028', 'P571', 'year', 25, (x) => `В каком году основан клуб «${x}»?`, { uniqueName: true }],
  ['club_city', 'sports', 'Q476028 Q4498974 Q13393265', 'P159', 'city', 25, (x) => `Из какого города клуб «${x}»?`, { uniqueName: true }],
  ['team_country', 'sports', 'Q4498974 Q13393265', 'P17', 'country', 15, (x) => `В какой стране играет «${x}»?`, { uniqueName: true }],
  ['stadium_city', 'sports', 'Q483110 Q1076486 Q641226', 'P131', 'city', 15, (x) => `В каком городе находится ${/стадион|арена/i.test(x) ? x : 'стадион «' + x + '»'}?`],
  ['university_city', 'general-knowledge', 'Q3918 Q902104 Q875538', 'P131', 'city', 20, (x) => `В каком городе находится ${x}?`],
  ['university_year', 'general-knowledge', 'Q3918 Q902104 Q875538', 'P571', 'year', 20, (x) => `${cap(x)} — год основания?`],
  ['language_script', 'language', 'Q34770 Q1288568', 'P282', 'entity', 40, (x) => `${cap(x)} — какая письменность?`, { cap: true }],
];

/** subjects: ids by class (or a custom WHERE) and fame, then label + all values of the property in parts */
async function subjects(classes, minSl, where = '', deep = false) {
  const cls = classes ? `VALUES ?cls { ${wd(classes)} } ?x wdt:P31${deep ? '/wdt:P279*' : ''} ?cls.` : '';
  return [...new Set((await sparql(`SELECT DISTINCT ?x WHERE { ${cls} ${where} ?x wikibase:sitelinks ?sl. FILTER(?sl >= ${minSl}) }`)).map((r) => r.x))];
}
async function labelled(ids) {
  const m = new Map();
  for (const r of await inParts(ids, 400, (v) => `SELECT ?x ?xLabel ?sl WHERE { VALUES ?x { ${v} } ?x wikibase:sitelinks ?sl. ${ru('?x')} ${lbl('?x')} }`)) {
    m.set(r.x, { id: r.x, label: unquote(r.xLabel), sl: +r.sl });
  }
  return m;
}
/** x -> its only value (all best-rank values counted, labels or not) */
async function onlyValue(ids, prop) {
  const vals = new Map();
  for (const r of await inParts(ids, 400, (v) => `SELECT ?x ?v WHERE { VALUES ?x { ${v} } ?x wdt:${prop} ?v. }`)) {
    if (!vals.has(r.x)) vals.set(r.x, new Set());
    vals.get(r.x).add(r.v);
  }
  return new Map([...vals].filter(([, s]) => s.size === 1).map(([x, s]) => [x, [...s][0]]));
}
async function valueInfo(ids, filter = '') {
  const m = new Map();
  for (const r of await inParts(ids, 300, (v) => `SELECT ?v ?vLabel ?sl ?c WHERE { VALUES ?v { ${v} } ?v wikibase:sitelinks ?sl. ${filter}
    OPTIONAL { ?v wdt:P17|wdt:P27|wdt:P495 ?c } ${lbl('?v')} }`)) {
    const x = m.get(r.v) ?? { id: r.v, label: r.vLabel, sl: +r.sl, c: r.c };
    m.set(r.v, x);
  }
  return m;
}
const ofClasses = (of) => `?v wdt:P31/wdt:P279* ?ofc. VALUES ?ofc { ${wd(of)} }`;

export async function build({ only = null } = {}) {
  const states = await loadStates();
  const out = [];
  for (const [type, category, classes, prop, kind, minSl, text, opt = {}] of TYPES) {
    if (only && !only.includes(type)) continue;
    const { drafts, add } = collector(category);
    let ids;
    if (kind === 'rank') { // animals: species with a Russian article, the family / order above them
      ids = await subjects(null, minSl, '?x wdt:P105 wd:Q7432; wdt:P171 [].');
    } else ids = await subjects(classes, minSl, opt.where ?? '', opt.deep);
    const subj = await labelled(ids);
    let names = null;
    if (opt.uniqueName) { // «Динамо»: a name shared by two subjects of the same classes is ambiguous
      const all = await sparql(`SELECT ?x ?xLabel WHERE { VALUES ?cls { ${wd(classes)} } ?x wdt:P31 ?cls. ${lbl('?x')} }`);
      names = Object.groupBy(all, (r) => norm(unquote(r.xLabel)));
    }
    const ok = [...subj.values()].filter((s) => goodSubject(s.label) && !(opt.cyrillic && !/^[^A-Za-z]*$/.test(s.label)) && (!opt.subject || opt.subject(s.label)) && !(names && (names[norm(s.label)]?.length ?? 0) > 1));
    const okIds = ok.map((s) => s.id);
    // the answer must not peek out of the question: «Аддис-Абебский университет» — Аддис-Абеба, «107 Рыб» — Рыбы
    const peeks = (s, correct) => typeof correct === 'string' && stems(correct).some((w) => norm(s.label).includes(w));
    const q = (s, correct, wrong, extra) => !peeks(s, correct) && add(type, s.id, s.label, s.sl, text(s.label), correct, wrong, extra);

    if (kind === 'year') {
      const ys = await oneYear(okIds, prop);
      for (const s of ok) {
        const y = ys.get(s.id);
        if (y && y >= 500 && y <= YEAR_NOW) q(s, y, yearPool(y, s.id + type));
      }
    } else if (kind === 'country') {
      const v = await onlyValue(okIds, prop);
      const freq = new Map();
      for (const c of v.values()) freq.set(c, (freq.get(c) ?? 0) + 1);
      for (const s of ok) {
        const st = states.get(v.get(s.id));
        if (!st || norm(st.label) === norm(s.label)) continue;
        const cands = countryCandidatesByFreq(states, st, freq);
        q(s, st.label, pool(st.label, cands, undefined, undefined, s.id), { group: st.label });
      }
    } else if (kind === 'city' || kind === 'entity') {
      const v = await onlyValue(okIds, prop);
      const filter = kind === 'city' ? ofClasses(CITY) : opt.of ? ofClasses(opt.of) : opt.human ? '?v wdt:P31 wd:Q5.' : '';
      const info = await valueInfo([...new Set(v.values())].filter((x) => /^Q\d+$/.test(x)), filter);
      // people: the answer and the wrong answers have the occupation (architects among architects)
      if (opt.job) {
        const has = new Set((await inParts([...info.keys()], 300, (x) => `SELECT DISTINCT ?v WHERE { VALUES ?v { ${x} } ?v wdt:P106/wdt:P279* wd:${opt.job}. }`)).map((r) => r.v));
        for (const k of [...info.keys()]) if (!has.has(k)) info.delete(k);
      }
      if (process.env.QF_DEBUG) console.error(type, 'subjects', ok.length, 'with one value', v.size, 'answers', info.size);
      const label = (x) => (opt.person ? noPatronymic(x.label) : opt.cap ? cap(unquote(x.label)) : unquote(x.label));
      const freq = new Map();
      for (const x of v.values()) freq.set(x, (freq.get(x) ?? 0) + 1);
      const answers = [...info.values()].map((x) => ({ ...x, sl: (freq.get(x.id) ?? 0) * 1000 + Math.min(x.sl, 999) }));
      const byId = new Map(answers.map((x) => [x.id, x]));
      for (const s of ok) {
        const a = byId.get(v.get(s.id));
        if (!a) continue;
        const correct = label(a);
        const cands = answers.filter((o) => o !== a).map((o) => ({ label: label(o), sl: o.sl, score: o.c && o.c === a.c ? 1 : 0 }));
        q(s, correct, pool(correct, cands, undefined, opt.latin ? anyAnswer : undefined, s.id), { group: correct, latinOk: opt.latin });
      }
    } else if (kind === 'rank') {
      // the family / order: the first ancestor of that rank (one only), with a Russian label
      const rows = await inParts(okIds, 200, (x) => `SELECT ?x ?f WHERE { VALUES ?x { ${x} } ?x wdt:P171+ ?f. ?f wdt:P105 wd:${opt.rank}. }`);
      const fam = new Map();
      for (const r of rows) { if (!fam.has(r.x)) fam.set(r.x, new Set()); fam.get(r.x).add(r.f); }
      const one = new Map([...fam].filter(([, s]) => s.size === 1).map(([x, s]) => [x, [...s][0]]));
      const info = await valueInfo([...new Set(one.values())].filter((x) => /^Q\d+$/.test(x)));
      // the order above each family / the class above each order: wrong answers from the same branch first
      const above = async (rank) => new Map((await inParts([...info.keys()], 200, (x) => `SELECT ?v ?u WHERE { VALUES ?v { ${x} } ?v wdt:P171+ ?u. ?u wdt:P105 wd:${rank}. }`)).map((r) => [r.v, r.u]));
      const up = await above(opt.rank === 'Q35409' ? 'Q36602' : 'Q37517'); // family -> order, order -> class
      const up2 = await above(opt.rank === 'Q35409' ? 'Q37517' : 'Q38348'); // family -> class, order -> phylum
      const kingdom = await above('Q36732'); // never a plant among animals (Чёрный перец — Приматы)
      const answers = [...info.values()];
      for (const s of ok) {
        const a = info.get(one.get(s.id));
        if (!a) continue;
        const correct = cap(a.label);
        if (!/^[^A-Za-z]*$/.test(correct)) continue;
        const cands = answers.filter((o) => o !== a && kingdom.get(o.id) && kingdom.get(o.id) === kingdom.get(a.id)).map((o) => ({ label: cap(o.label), sl: o.sl, score: up.get(o.id) && up.get(o.id) === up.get(a.id) ? 2 : up2.get(o.id) && up2.get(o.id) === up2.get(a.id) ? 1 : 0 }));
        q(s, correct, pool(correct, cands, undefined, undefined, s.id), { group: correct });
      }
    }
    console.error(type, drafts.length);
    out.push(...drafts);
  }
  return out;
}

if (process.argv[1]?.endsWith('build-more.mjs')) {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const d = await build({ only });
  console.log(Object.entries(Object.groupBy(d, (x) => x.type)).map(([t, xs]) => `${t}: ${xs.length}`).join(', '));
  if (process.argv.includes('--sample')) for (const t of Object.values(Object.groupBy(d, (x) => x.type))) for (const x of t.slice(0, 3)) console.log(x.text, '|', x.correct, '|', x.wrong.slice(0, 3).join(', '));
}
