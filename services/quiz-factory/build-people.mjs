// Famous people from Wikidata (no model): export build().
//   «В каком году родился Лев Толстой?», «В каком году умерла Мария Кюри?», «Усэйн Болт — из какой страны?»
// Each person goes into ONE category (the first matching group below), so the same question never appears twice.
// Dates: exactly one best-rank value with day/month/year precision (no "1500s", no "около 1450"), not BCE.
// Country: exactly one citizenship, a current sovereign state, born 1900 or later (older borders are a mess).
import { sparql, ru, lbl, inParts, pool, goodSubject, loadStates, countryCandidatesByFreq, collector, noPatronymic, yearPool, oneYear, YEAR_NOW } from './lib/common.mjs';

const GROUPS = [
  // [category, key, occupations (direct P106 values), min sitelinks, sport people?]
  ['history', 'politician', 'Q82955 Q116 Q189290 Q11900058 Q2304859 Q48352', 30],
  // no «university teacher» (Q1622272) and «philosopher» here, no «songwriter» in music: Толстой, Мураками, Фет would land there
  ['science', 'scientist', 'Q901 Q169470 Q593644 Q170790 Q864503 Q11063 Q205375 Q81096 Q39631 Q188094', 25],
  ['movies', 'actor', 'Q33999 Q10800557 Q2526255 Q28389 Q10798782', 30],
  ['art', 'artist', 'Q1028181 Q1281618 Q42973 Q33231', 25],
  ['music', 'musician', 'Q36834 Q177220 Q639669 Q158852 Q488205', 30],
  ['literature', 'writer', 'Q36180 Q6625963 Q49757 Q214917 Q4853732', 25],
  ['sports', 'athlete', null, 30],
];
const COUNTRY_TYPES = new Set(['athlete', 'writer', 'actor', 'musician', 'scientist']);
const FEMALE = new Set(['Q6581072', 'Q1052281']);

export async function build() {
  const states = await loadStates();
  const out = [];
  const used = new Set();
  for (const [category, key, jobs, minSl] of GROUPS) {
    const { drafts, add } = collector(category);
    // one query per occupation (all of them in one query time out)
    const found = [];
    for (const w of jobs ? jobs.split(' ').map((q) => `?p wdt:P106 wd:${q}.`) : ['?p wdt:P641 [].']) {
      found.push(...(await sparql(`SELECT DISTINCT ?p WHERE { ${w} ?p wikibase:sitelinks ?sl. FILTER(?sl >= ${minSl}) ?p wdt:P31 wd:Q5. }`)).map((r) => r.p));
    }
    let ids = [...new Set(found)].filter((p) => !used.has(p));
    // sport: athletes by occupation (Билл Гейтс has a sport too)
    if (!jobs) ids = (await inParts(ids, 300, (v) => `SELECT DISTINCT ?p WHERE { VALUES ?p { ${v} } ?p wdt:P106/wdt:P279* wd:Q2066131. }`)).map((r) => r.p);
    ids.forEach((p) => used.add(p));
    const info = new Map();
    for (const r of await inParts(ids, 400, (v) => `SELECT ?p ?pLabel ?sl ?sex WHERE { VALUES ?p { ${v} } ?p wikibase:sitelinks ?sl.
      OPTIONAL { ?p wdt:P21 ?sex } ${ru('?p')} ${lbl('?p')} }`)) {
      const name = noPatronymic(r.pLabel);
      if (!goodSubject(name, 50) || name.includes(',') || name.split(' ').length < 2 || /[A-Za-z]/.test(name)) continue; // single names / nicknames are ambiguous
      info.set(r.p, { name, sl: +r.sl, f: FEMALE.has(r.sex) });
    }
    const keep = [...info.keys()];
    const born = await oneYear(keep, 'P569');
    const died = await oneYear(keep, 'P570');
    for (const [p, y] of born) {
      const x = info.get(p);
      if (y < 1 || y > YEAR_NOW - 10) continue;
      add(`${key}_born`, p, x.name, x.sl, `В каком году ${x.f ? 'родилась' : 'родился'} ${x.name}?`, y, yearPool(y, p + 'b'));
    }
    for (const [p, y] of died) {
      const x = info.get(p);
      if (y < 1 || y > YEAR_NOW || (born.get(p) && y - born.get(p) < 5)) continue;
      add(`${key}_died`, p, x.name, x.sl * 0.8, `В каком году ${x.f ? 'умерла' : 'умер'} ${x.name}?`, y, yearPool(y, p + 'd'));
    }
    if (COUNTRY_TYPES.has(key)) {
      const cz = new Map();
      for (const r of await inParts(keep, 400, (v) => `SELECT ?p ?c WHERE { VALUES ?p { ${v} } ?p wdt:P27 ?c. }`)) {
        if (!cz.has(r.p)) cz.set(r.p, new Set());
        cz.get(r.p).add(r.c);
      }
      const freq = new Map();
      for (const cs of cz.values()) if (cs.size === 1) freq.set([...cs][0], (freq.get([...cs][0]) ?? 0) + 1);
      for (const [p, cs] of cz) {
        const st = cs.size === 1 && states.get([...cs][0]);
        if (!st || !(born.get(p) >= 1900)) continue;
        const x = info.get(p);
        add(`${key}_country`, p, x.name, x.sl, `${x.name} — из какой страны?`, st.label, pool(st.label, countryCandidatesByFreq(states, st, freq), undefined, undefined, p), { group: st.label });
      }
    }
    out.push(...drafts);
  }
  return out;
}

if (process.argv[1]?.endsWith('build-people.mjs')) {
  const d = await build();
  console.log(Object.entries(Object.groupBy(d, (x) => x.type)).map(([t, xs]) => `${t}: ${xs.length}`).join(', '));
}
