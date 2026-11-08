// Sport drafts from Wikidata: node build-sport.mjs [--total=100] [--skip=N] [--out=data/sport-drafts.json]
// Same rules as build-geo.mjs: one best-rank value only, Russian label and Russian Wikipedia article, wrong answers of
// the same kind that are surely wrong. Quiz-show wording without declension, so the model only checks:
//   «Где прошла летняя Олимпиада-1980?», «Где прошёл чемпионат мира по футболу 2018 года?»,
//   «Кто выиграл чемпионат мира по футболу 2014 года?», «Майкл Фелпс — какой вид спорта?», «В какой стране играет «Ювентус»?»
import { writeFileSync, mkdirSync } from 'node:fs';
import { sparql, goodLabel } from './lib/wikidata.mjs';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=')[1];
const SKIP = Number(arg('skip', 0));
const OUT = arg('out', 'data/sport-drafts.json');
const ru = (v) => `?art_${v.slice(1)} schema:about ${v}; schema:isPartOf <https://ru.wikipedia.org/>.`;
const lbl = (...vs) => vs.map((v) => `${v} rdfs:label ${v}Label. FILTER(LANG(${v}Label) = 'ru')`).join(' ');
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const YEAR_NOW = new Date().getFullYear();
const POOL = 10;

function single(rows, key, val) {
  const m = new Map();
  for (const r of rows) {
    if (!r[val]) continue;
    if (!m.has(r[key])) m.set(r[key], { row: r, vals: new Set() });
    m.get(r[key]).vals.add(r[val]);
  }
  return [...m.values()].filter((x) => x.vals.size === 1).map((x) => x.row);
}
/** wrong answers: distinct labels from candidates (best first), never the correct one */
function pool(correct, candidates) {
  const seen = new Set([norm(correct)]);
  const out = [];
  for (const c of candidates) {
    if (out.length >= POOL) break;
    if (!goodLabel(c) || seen.has(norm(c))) continue;
    seen.add(norm(c));
    out.push(c);
  }
  return out;
}
const drafts = [];
function add(type, id, subject, sl, text, correct, wrong) {
  if (!goodLabel(correct) || wrong.length < 3 || text.length > 150) return;
  if (norm(text).includes(norm(correct))) return;
  drafts.push({ id: `${type}:${id}`, type, category: 'sports', subject, subject_qid: id, popularity: sl, template: text, correct, wrong });
}

// --- countries (sovereign states + continents) for country answers
const states = new Map();
for (const r of await sparql(`SELECT ?c ?cLabel ?sl ?cont WHERE { ?c wdt:P31 wd:Q3624078; wikibase:sitelinks ?sl.
  FILTER NOT EXISTS { ?c wdt:P576 [] } OPTIONAL { ?c wdt:P30 ?cont } ${ru('?c')} ${lbl('?c')} }`)) {
  const s = states.get(r.c) ?? { id: r.c, label: r.cLabel, sl: +r.sl, conts: new Set() };
  if (r.cont) s.conts.add(r.cont);
  states.set(r.c, s);
}
const byPop = (a, b) => b.sl - a.sl;
const near = (st) => [...states.values()].filter((o) => o !== st).sort((a, b) =>
  ([...b.conts].some((c) => st.conts.has(c)) - [...a.conts].some((c) => st.conts.has(c))) || byPop(a, b)).map((s) => s.label);

// --- 1. Olympic host cities (P3450 = summer / winter Games)
for (const [series, word] of [['Q159821', 'летняя'], ['Q82414', 'зимняя']]) {
  // P276 is sometimes a venue ("Олимпийский парк Хвэнге"): only places that are human settlements count
  const rows = single(await sparql(`SELECT ?e ?eLabel ?sl ?city ?cityLabel WHERE { ?e wdt:P3450 wd:${series}; wikibase:sitelinks ?sl; wdt:P276 ?city.
    FILTER EXISTS { ?city wdt:P31/wdt:P279* wd:Q486972 } ${lbl('?e', '?city')} }`), 'e', 'city');
  const eds = rows.map((r) => ({ ...r, cityLabel: r.cityLabel.replace(/^Горнолыжный курорт /, ''), year: +(r.eLabel.match(/\b(18|19|20)\d\d\b/) ?? [0])[0] })).filter((r) => r.year && r.year <= YEAR_NOW);
  const cities = [...new Set(eds.map((r) => r.cityLabel))];
  for (const r of eds) {
    if (eds.some((o) => o !== r && o.year === r.year)) continue; // two items for one year: unclear
    add(`olympics_${word === 'летняя' ? 'summer' : 'winter'}`, r.e, r.eLabel, +r.sl, `Где прошла ${word} Олимпиада-${r.year}?`, r.cityLabel,
      pool(r.cityLabel, cities.filter((c) => c !== r.cityLabel)));
  }
}

// --- 2. football: World Cup (Q19317) and Euro (Q260858) hosts and winners (winner = the national team's country)
for (const [series, name, key] of [['Q19317', 'чемпионат мира по футболу', 'wc'], ['Q260858', 'чемпионат Европы по футболу', 'euro']]) {
  const rows = await sparql(`SELECT ?e ?eLabel ?sl ?host ?win ?winCountry WHERE { ?e wdt:P3450 wd:${series}; wikibase:sitelinks ?sl.
    OPTIONAL { ?e wdt:P17 ?host } OPTIONAL { ?e wdt:P1346 ?win. OPTIONAL { ?win wdt:P17 ?winCountry } } ${lbl('?e')} }`);
  const year = (r) => +(r.eLabel.match(/\b(19|20)\d\d\b/) ?? [0])[0];
  const hosts = single(rows, 'e', 'host').filter((r) => states.has(r.host) && year(r) && year(r) <= YEAR_NOW);
  const winners = single(single(rows, 'e', 'win'), 'e', 'winCountry').filter((r) => states.has(r.winCountry) && year(r));
  const footballNations = [...new Set([...hosts.map((r) => r.host), ...winners.map((r) => r.winCountry)])].map((id) => states.get(id).label);
  for (const r of hosts) {
    const st = states.get(r.host);
    add(`${key}_host`, r.e, r.eLabel, +r.sl, `Где прошёл ${name} ${year(r)} года?`, st.label, pool(st.label, [...footballNations, ...near(st)]));
  }
  for (const r of winners) {
    const st = states.get(r.winCountry);
    add(`${key}_winner`, r.e, r.eLabel, +r.sl, `Кто выиграл ${name} ${year(r)} года?`, st.label, pool(st.label, [...footballNations, ...near(st)]));
  }
}

// --- 3. famous sportspeople and their (single) sport
{
  // in two steps: people with a sport (P641) and many Wikipedias, then their labels (one query times out)
  const ids = (await sparql(`SELECT ?p ?sl WHERE { ?p wdt:P641 []; wikibase:sitelinks ?sl. FILTER(?sl >= 90) ?p wdt:P31 wd:Q5. }`));
  const rows = [];
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300);
    rows.push(...await sparql(`SELECT ?p ?pLabel ?sl ?sport ?sportLabel WHERE { VALUES ?p { ${part.map((r) => 'wd:' + r.p).join(' ')} }
      ?p wikibase:sitelinks ?sl; wdt:P641 ?sport. ${ru('?p')} ${lbl('?p', '?sport')} }`));
  }
  // only sportspeople by occupation (P106 ⊂ athlete): presidents have golf as their "sport" too
  const athletes = new Set();
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300);
    for (const r of await sparql(`SELECT DISTINCT ?p WHERE { VALUES ?p { ${part.map((x) => 'wd:' + x.p).join(' ')} }
      ?p wdt:P106 ?job. ?job wdt:P279* wd:Q2066131. }`)) athletes.add(r.p);
  }
  // ... and famous for sport, not for something else: Нильс Бор kept goal, Камю too, Буш played rugby at college
  const OTHER_FAME = 'wd:Q82955 wd:Q36180 wd:Q901 wd:Q483501 wd:Q33999 wd:Q639669 wd:Q131524 wd:Q81096 wd:Q189290 wd:Q4964182 wd:Q1930187 wd:Q2526255 wd:Q2259532 wd:Q250867';
  const famousElse = new Set();
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300);
    for (const r of await sparql(`SELECT DISTINCT ?p WHERE { VALUES ?p { ${part.map((x) => 'wd:' + x.p).join(' ')} }
      VALUES ?fame { ${OTHER_FAME} } ?p wdt:P106 ?job. ?job wdt:P279* ?fame. }`)) famousElse.add(r.p);
  }
  const people = single(rows.filter((r) => athletes.has(r.p) && !famousElse.has(r.p)), 'p', 'sport');
  const count = new Map();
  for (const r of people) count.set(r.sportLabel, (count.get(r.sportLabel) ?? 0) + 1);
  const sports = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => cap(s));
  for (const r of people) {
    if (!goodLabel(r.pLabel, 60) || r.pLabel.split(' ').length < 2) continue; // "Пеле"-style single names are fine, but nicknames are often ambiguous
    const name = r.pLabel.replace(/^(\S+) \S+(вич|вна|ич|кызы|оглы) (\S+)$/, '$1 $3'); // without the patronymic
    add('athlete_sport', r.p, name, +r.sl, `${name} — какой вид спорта?`, cap(r.sportLabel), pool(cap(r.sportLabel), sports));
  }
}

// --- 4. famous football clubs and their country
{
  const rows = single(await sparql(`SELECT ?c ?cLabel ?sl ?country WHERE { ?c wdt:P31 wd:Q476028; wikibase:sitelinks ?sl. FILTER(?sl >= 50)
    ?c wdt:P17 ?country. ${ru('?c')} ${lbl('?c')} }`), 'c', 'country');
  for (const r of rows) {
    const st = states.get(r.country);
    if (!st || !goodLabel(r.cLabel, 40)) continue;
    add('club_country', r.c, r.cLabel, +r.sl, `В какой стране играет «${r.cLabel}»?`, st.label, pool(st.label, near(st)));
  }
}

// --- pick: the most famous of each type
const SHARE = { olympics_summer: 10, olympics_winter: 10, wc_host: 12, wc_winner: 12, euro_host: 8, euro_winner: 8, athlete_sport: 22, club_country: 21 };
const counts = {};
const picked = [];
for (const [type, n] of Object.entries(SHARE)) {
  const all = drafts.filter((d) => d.type === type).sort((a, b) => b.popularity - a.popularity);
  counts[type] = all.length;
  // one answer at most 5 times per batch (otherwise half the athletes are footballers)
  const perAnswer = new Map();
  const varied = type === 'athlete_sport'
    ? all.filter((d) => { const k = perAnswer.get(d.correct) ?? 0; perAnswer.set(d.correct, k + 1); return k < 5 * (1 + Math.floor(SKIP / n)); })
    : all;
  picked.push(...varied.slice(SKIP, SKIP + n));
}
mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify(picked, null, 1));
console.log('available per type', counts, '\npicked', picked.length, '->', OUT);
