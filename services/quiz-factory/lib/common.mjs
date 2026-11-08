// Shared pieces of the build-*.mjs question builders (Wikidata -> questions, no model involved).
import { sparql, goodLabel } from './wikidata.mjs';

export { sparql, goodLabel };
/** an answer button: a real Russian label, no Latin letters («Франк КФА BCEAO» is not an answer) */
export const goodAnswer = (s, max = 32) => goodLabel(s, max) && !/[A-Za-z]/.test(s);
export const POOL = 14; // wrong answers per question: the first 3 go into the quiz, 11 more wait in questions.wrong_pool
export const ru = (v) => `?art_${v.slice(1)} schema:about ${v}; schema:isPartOf <https://ru.wikipedia.org/>.`;
// rdfs:label instead of the label service: the service times out on big result sets
export const lbl = (...vs) => vs.map((v) => `${v} rdfs:label ${v}Label. FILTER(LANG(${v}Label) = 'ru')`).join(' ');
export const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
export const cap = (s) => s[0].toUpperCase() + s.slice(1);
export const YEAR_NOW = new Date().getFullYear();
/** "Лев Николаевич Толстой" -> "Лев Толстой" */
export const noPatronymic = (s) => s.replace(/^(\S+) \S+(вич|вна|ич|кызы|оглы) (\S+)$/, '$1 $3');
/** a name or title shown inside a question: present, not a bare Q-id, no "(disambiguation)", not too long */
export const goodSubject = (s, max = 80) => typeof s === 'string' && !/^Q\d+$/.test(s) && !/[()]/.test(s) && s.length <= max;

/** keeps subjects whose property has exactly one distinct value (rows: {key, val, ...}) */
export function single(rows, key, val) {
  const m = new Map();
  for (const r of rows) {
    if (!r[val]) continue;
    if (!m.has(r[key])) m.set(r[key], { row: r, vals: new Set() });
    m.get(r[key]).vals.add(r[val]);
  }
  return [...m.values()].filter((x) => x.vals.size === 1).map((x) => x.row);
}

/** big VALUES queries in parts (one query over everything times out) */
export async function inParts(ids, size, q) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(...await sparql(q(ids.slice(i, i + size).map((x) => 'wd:' + x).join(' '))));
  return out;
}

/** wrong answers from candidates [{label, sl, score?}]: best score first, then the most famous; distinct, never the correct one */
// seed: equally close candidates are shuffled a little by fame (x0.4..1.6), so the same famous three do not come every time
export function pool(correct, candidates, n = POOL, check = goodAnswer, seed = null) {
  const seen = new Set([norm(correct)]);
  const out = [];
  const rnd = seed ? rng(seed) : null;
  const fame = new Map(candidates.map((c) => [c, (c.sl ?? 0) * (rnd ? 0.4 + rnd() * 1.2 : 1)]));
  const sorted = [...candidates].sort((a, b) => ((b.score ?? 0) - (a.score ?? 0)) || (fame.get(b) - fame.get(a)));
  for (const c of sorted) {
    if (out.length >= n) break;
    if (!check(c.label) || seen.has(norm(c.label))) continue;
    seen.add(norm(c.label));
    out.push(c.label);
  }
  return out;
}

/** a deterministic random generator per question */
export function rng(seed) {
  let h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => ((h = (h * 1103515245 + 12345) >>> 0) / 2 ** 32);
}

/** wrong numbers: 6-60% away from the real one, "precise" last digits like it, 4% apart from each other */
export function numberPool(v, seed, { max = Infinity, min = 1 } = {}) {
  const rnd = rng(seed);
  const out = [];
  for (let i = 0; out.length < POOL && i < 2000; i++) {
    const f = (rnd() < 0.5 ? -1 : 1) * (0.06 + rnd() * (0.08 + out.length * 0.035));
    const x = Math.round(v * (1 + f)) + Math.round((rnd() - 0.5) * 14);
    if (x >= max || x < min) continue;
    if ([v, ...out].every((y) => Math.abs(y - x) / v >= 0.04)) out.push(x);
  }
  return out;
}

/** wrong years: close first (±2..12), then further; never in the future, 2 years apart */
export function yearPool(y, seed) {
  const rnd = rng(seed);
  const out = [];
  for (let i = 0; out.length < POOL && i < 3000; i++) {
    const spread = 4 + out.length * 4;
    const x = y + (rnd() < 0.5 ? -1 : 1) * (2 + Math.floor(rnd() * spread));
    if (x > YEAR_NOW || x < 1) continue;
    if ([y, ...out].every((z) => Math.abs(z - x) >= 2)) out.push(x);
  }
  return out;
}

/** current sovereign states: id -> {label, sl, conts, neighbours} */
let statesCache = null;
export async function loadStates() {
  if (statesCache) return statesCache;
  const states = new Map();
  for (const r of await sparql(`SELECT ?c ?cLabel ?sl ?cont WHERE {
    ?c wdt:P31 wd:Q3624078; wikibase:sitelinks ?sl. FILTER NOT EXISTS { ?c wdt:P576 [] }
    OPTIONAL { ?c wdt:P30 ?cont } ${ru('?c')} ${lbl('?c')} }`)) {
    if (!goodLabel(r.cLabel)) continue;
    const s = states.get(r.c) ?? { id: r.c, label: r.cLabel, sl: +r.sl, conts: new Set(), neighbours: new Set() };
    if (r.cont) s.conts.add(r.cont);
    states.set(r.c, s);
  }
  // neighbours: a mountain on a border may be "in" both countries, so a neighbour is never a wrong answer for it
  for (const r of await sparql(`SELECT ?c ?n WHERE { ?c wdt:P31 wd:Q3624078; wdt:P47 ?n. ?n wdt:P31 wd:Q3624078. }`)) states.get(r.c)?.neighbours.add(r.n);
  statesCache = states;
  return states;
}
export const sameContinent = (a, b) => [...a.conts].some((c) => b.conts.has(c));
/** other countries as wrong answers: same continent first */
export const countryCandidates = (states, st, exclude = () => false) =>
  [...states.values()].filter((o) => o !== st && !exclude(o)).map((o) => ({ label: o.label, sl: o.sl, score: sameContinent(o, st) ? 1 : 0 }));

/** a question collector: checks the answer, the pool and that the text does not give the answer away */
export function collector(category) {
  const drafts = [];
  const add = (type, id, subject, sl, text, correct, wrong, extra = {}) => {
    // numbers (years) are fine as they are; words need a real Russian label
    if ((typeof correct === 'number' ? false : !goodAnswer(correct)) || wrong.length < 3 || text.length > 150) return false;
    if (norm(text).includes(norm(String(correct)))) return false;
    drafts.push({ id: `${type}:${id}`, type, category, subject, subject_qid: id, popularity: sl, text, correct: String(correct), wrong: wrong.map(String), ...extra });
    return true;
  };
  return { drafts, add };
}
