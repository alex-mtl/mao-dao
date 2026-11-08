// Geography drafts from Wikidata: node build-geo.mjs [--per-type=N] [--out=data/geo-drafts.json]
// Only facts we can stand behind: the subject and the answer both have a Russian Wikipedia article and a Russian
// label, the property has exactly ONE best-rank value (disputed borders, two capitals, unsure heights drop out),
// countries are current sovereign states. Each draft = template question + correct answer + a pool of wrong
// answers of the same kind (another capital, another country of the same continent...), so any 3 of the pool
// make a valid question and a round can pick different ones each time.
import { writeFileSync, mkdirSync } from 'node:fs';
import { sparql, goodLabel } from './lib/wikidata.mjs';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=')[1];
const PER_TYPE = Number(arg('per-type', 20));
const OUT = arg('out', 'data/geo-drafts.json');
const RU = '?art schema:about ?X; schema:isPartOf <https://ru.wikipedia.org/>.';
const ru = (v) => RU.replaceAll('?X', v).replace('?art', `?art_${v.slice(1)}`);
// rdfs:label instead of the label service: the service times out on big result sets
const lbl = (...vs) => vs.map((v) => `${v} rdfs:label ${v}Label. FILTER(LANG(${v}Label) = 'ru')`).join(' ');
const POOL = 10;

/** subject -> Set of values; keeps subjects whose property has exactly one distinct value */
function single(rows, key, val) {
  const m = new Map();
  for (const r of rows) {
    if (!r[val]) continue;
    if (!m.has(r[key])) m.set(r[key], { row: r, vals: new Set() });
    m.get(r[key]).vals.add(r[val]);
  }
  return [...m.values()].filter((x) => x.vals.size === 1).map((x) => x.row);
}
const byPop = (a, b) => b.sl - a.sl;
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');

// --- sovereign states: label, popularity, continents
const stateRows = await sparql(`SELECT ?c ?cLabel ?sl ?cont WHERE {
  ?c wdt:P31 wd:Q3624078; wikibase:sitelinks ?sl. FILTER NOT EXISTS { ?c wdt:P576 [] }
  OPTIONAL { ?c wdt:P30 ?cont } ${ru('?c')} ${lbl('?c')} }`);
const states = new Map();
for (const r of stateRows) {
  if (!goodLabel(r.cLabel)) continue;
  const s = states.get(r.c) ?? { id: r.c, label: r.cLabel, sl: +r.sl, conts: new Set(), neighbours: new Set() };
  if (r.cont) s.conts.add(r.cont);
  states.set(r.c, s);
}
// neighbours: a mountain on a border may be "in" both countries, so a neighbour is never a wrong answer for it
for (const r of await sparql(`SELECT ?c ?n WHERE { ?c wdt:P31 wd:Q3624078; wdt:P47 ?n. ?n wdt:P31 wd:Q3624078. }`)) states.get(r.c)?.neighbours.add(r.n);
const sameContinent = (a, b) => [...a.conts].some((c) => b.conts.has(c));
console.log('states', states.size);

/** wrong answers: other items of the same kind, same continent first, most famous first */
function poolFor(correctLabel, candidates, near) {
  const seen = new Set([norm(correctLabel)]);
  const out = [];
  const sorted = [...candidates].sort((a, b) => (near(b) - near(a)) || byPop(a, b));
  for (const c of sorted) {
    if (out.length >= POOL) break;
    if (!goodLabel(c.label) || seen.has(norm(c.label))) continue;
    seen.add(norm(c.label));
    out.push(c.label);
  }
  return out;
}

const drafts = [];
function add(type, subject, text, correct, pool, extra = {}) {
  if (!goodLabel(correct) || pool.length < 3) return;
  if (norm(text).includes(norm(correct))) return; // the question must not give the answer away
  drafts.push({ id: `${type}:${subject.id}`, type, subject: subject.label, subject_qid: subject.id, popularity: subject.sl,
    template: text, correct, wrong: pool, ...extra });
}

// --- 1. capitals
{
  const rows = single(await sparql(`SELECT ?c ?cap ?capLabel ?capSl WHERE {
    ?c wdt:P31 wd:Q3624078; wdt:P36 ?cap. FILTER NOT EXISTS { ?c wdt:P576 [] }
    ?cap wikibase:sitelinks ?capSl. ${ru('?cap')} ${lbl('?cap')} }`), 'c', 'cap');
  const caps = rows.filter((r) => states.has(r.c)).map((r) => ({ state: states.get(r.c), label: r.capLabel, sl: +r.capSl }));
  for (const c of caps) {
    const pool = poolFor(c.label, caps.filter((o) => o !== c).map((o) => ({ ...o, conts: o.state.conts })), (o) => sameContinent(o, c.state));
    add('capital', c.state, `Какой город является столицей страны «${c.state.label}»?`, c.label, pool, { hint: 'страна → столица' });
  }
}

// --- 2. highest point of a country
{
  const rows = single(await sparql(`SELECT ?c ?hp ?hpLabel ?hpSl WHERE {
    ?c wdt:P31 wd:Q3624078; wdt:P610 ?hp. FILTER NOT EXISTS { ?c wdt:P576 [] }
    ?hp wikibase:sitelinks ?hpSl. ${ru('?hp')} ${lbl('?hp')} }`), 'c', 'hp');
  const stateLabels = new Set([...states.values()].map((s) => norm(s.label)));
  const hps = rows.filter((r) => states.has(r.c)).map((r) => ({ state: states.get(r.c), label: r.hpLabel, sl: +r.hpSl, id: r.hp }));
  for (const h of hps) {
    if (hps.some((o) => o !== h && o.id === h.id)) continue; // shared by two countries: ambiguous
    if (stateLabels.has(norm(h.label))) continue;
    const pool = poolFor(h.label, hps.filter((o) => o !== h).map((o) => ({ ...o, conts: o.state.conts })), (o) => sameContinent(o, h.state)).filter((l) => !stateLabels.has(norm(l)));
    add('highest_point', h.state, `Какая вершина является высшей точкой страны «${h.state.label}»?`, h.label, pool, { hint: 'страна → высшая точка' });
  }
}

// --- 3. which country a big city / a mountain is in
const countryOf = async (type, classes, minSl, template) => {
  const rows = single(await sparql(`SELECT ?x ?xLabel ?sl ?country WHERE {
    VALUES ?cls { ${classes} } ?x wdt:P31 ?cls; wikibase:sitelinks ?sl. FILTER(?sl >= ${minSl})
    ?x wdt:P17 ?country. ${ru('?x')} ${lbl('?x')} }`), 'x', 'country');
  const capitals = new Set(drafts.filter((d) => d.type === 'capital').map((d) => norm(d.correct)));
  const all = [...states.values()];
  for (const r of rows) {
    const st = states.get(r.country);
    if (!st || !goodLabel(r.xLabel, 60)) continue;
    if (type === 'city_country' && capitals.has(norm(r.xLabel))) continue; // capitals have their own questions
    const pool = poolFor(st.label, all.filter((o) => o !== st && (type !== 'mountain_country' || !st.neighbours.has(o.id))), (o) => sameContinent(o, st));
    add(type, { id: r.x, label: r.xLabel, sl: +r.sl }, template(r.xLabel), st.label, pool);
  }
};
const MOUNTAINS = 'wd:Q8502 wd:Q8072 wd:Q169358 wd:Q207326';
await countryOf('city_country', 'wd:Q515 wd:Q1637706 wd:Q200250 wd:Q1549591', 80, (x) => `В какой стране находится город ${x}?`);
await countryOf('mountain_country', MOUNTAINS, 25, (x) => `В какой стране находится вершина ${x}?`);

// --- 4. elevation of a mountain (metres, one best-rank value)
{
  // in two steps: one query over every mountain with its heights times out
  const ids = [...new Set((await sparql(`SELECT ?m WHERE {
    VALUES ?cls { ${MOUNTAINS} } ?m wdt:P31 ?cls; wikibase:sitelinks ?sl. FILTER(?sl >= 30) ${ru('?m')} }`)).map((r) => r.m))];
  const rows = [];
  for (let i = 0; i < ids.length; i += 250) {
    rows.push(...await sparql(`SELECT ?m ?mLabel ?sl ?e ?u WHERE {
      VALUES ?m { ${ids.slice(i, i + 250).map((x) => 'wd:' + x).join(' ')} } ?m wikibase:sitelinks ?sl.
      ?m p:P2044 ?st. ?st a wikibase:BestRank; psv:P2044 [ wikibase:quantityAmount ?e; wikibase:quantityUnit ?u ].
      ${lbl('?m')} }`));
  }
  const one = single(rows.map((r) => ({ ...r, ev: `${r.e}|${r.u}` })), 'm', 'ev');
  for (const r of one) {
    if (r.u !== 'Q11573' || !goodLabel(r.mLabel, 60)) continue; // metres only
    const e = Math.round(+r.e);
    if (e < 500) continue;
    const pool = numericPool(e, `${r.m}`);
    add('elevation', { id: r.m, label: r.mLabel, sl: +r.sl }, `Какова высота вершины ${r.mLabel} над уровнем моря?`, fmtM(e), pool.map(fmtM), { hint: 'вершина → высота' });
  }
}

// --- 5. where a river flows into
{
  const rows = single(await sparql(`SELECT ?r ?rLabel ?sl ?mouth ?mouthLabel ?mSl ?mIsRiver WHERE {
    ?r wdt:P31 wd:Q4022; wikibase:sitelinks ?sl; wdt:P403 ?mouth. FILTER(?sl >= 40)
    ?mouth wikibase:sitelinks ?mSl. FILTER(?mSl >= 30)
    BIND(EXISTS { ?mouth wdt:P31 wd:Q4022 } AS ?mIsRiver)
    ${ru('?r')} ${ru('?mouth')} ${lbl('?r', '?mouth')} }`), 'r', 'mouth');
  const parts = new Map(); // mouth -> every water body it is part of (P361*, P4614 drainage basin excluded)
  for (const r of await sparql(`SELECT ?m ?up WHERE { ?r wdt:P31 wd:Q4022; wikibase:sitelinks ?sl; wdt:P403 ?m. FILTER(?sl >= 40) ?m wdt:P361+ ?up. }`)) {
    if (!parts.has(r.m)) parts.set(r.m, new Set()); parts.get(r.m).add(r.up);
  }
  const oceans = new Set((await sparql(`SELECT ?o WHERE { ?o wdt:P31 wd:Q9430 }`)).map((r) => r.o));
  const mouths = new Map();
  for (const r of rows) mouths.set(r.mouth, { id: r.mouth, label: r.mouthLabel, sl: +r.mSl, river: r.mIsRiver === 'true', ocean: oceans.has(r.mouth) });
  const related = (a, b) => parts.get(a.id)?.has(b.id) || parts.get(b.id)?.has(a.id);
  for (const r of rows) {
    if (!goodLabel(r.rLabel, 60)) continue;
    const m = mouths.get(r.mouth);
    const pool = poolFor(m.label, [...mouths.values()].filter((o) => o !== m && !related(o, m) && (m.ocean || !o.ocean) && o.river === m.river), () => 0);
    add('river_mouth', { id: r.r, label: r.rLabel, sl: +r.sl }, `Куда впадает река ${r.rLabel}?`, m.label, pool, { hint: 'река → устье' });
  }
}

function fmtM(n) { return `${n} м`; }
/** plausible wrong heights: 8-35% away, with "precise" last digits like the real one, at least 6% apart from each other */
function numericPool(e, seed) {
  let h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const out = [];
  for (let i = 0; out.length < 8 && i < 200; i++) {
    const f = (rnd() < 0.5 ? -1 : 1) * (0.08 + rnd() * 0.27);
    const v = Math.round(e * (1 + f)) + Math.round((rnd() - 0.5) * 14);
    if (v >= 8849 || v < 100) continue;
    if ([e, ...out].every((x) => Math.abs(x - v) / e >= 0.06)) out.push(v);
  }
  return out;
}

// --- pilot pick: the most famous subjects of each type
const counts = {};
const picked = [];
for (const type of ['capital', 'city_country', 'mountain_country', 'elevation', 'highest_point', 'river_mouth']) {
  const all = drafts.filter((d) => d.type === type).sort((a, b) => b.popularity - a.popularity);
  counts[type] = all.length;
  picked.push(...all.slice(0, PER_TYPE));
}
mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify(picked, null, 1));
console.log('available per type', counts, '\npicked', picked.length, '->', OUT);
