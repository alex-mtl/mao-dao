// Literature, art, cinema and music questions from Wikidata (no model): export build().
//   «Кто написал «Война и мир»?», «Кто написал картину «Мона Лиза»?», «Где хранится картина «Мона Лиза»?»,
//   «Кто снял фильм «Титаник»?», «В каком году вышел фильм «Титаник»?», «Кто написал оперу «Кармен»?»,
//   «Из какой страны группа «ABBA»?»
// One best-rank value only (co-authors, co-directors, two museums drop out). Wrong people: of the same kind
// (other writers / painters / directors), the same country and century first.
import { sparql, ru, lbl, cap, single, inParts, pool, goodSubject, loadStates, countryCandidates, collector, noPatronymic, yearPool, YEAR_NOW } from './lib/common.mjs';

const unquote = (s) => s.replace(/^[«"](.*)[»"]$/, '$1');

/** works of some classes with exactly one value of `prop`; ids first, details in parts (one query times out) */
async function works(classes, prop, minSl, via = 'wdt:P31') {
  const ids = [...new Set((await sparql(`SELECT ?w WHERE { VALUES ?cls { ${classes} } ?w ${via} ?cls; wikibase:sitelinks ?sl. FILTER(?sl >= ${minSl}) }`)).map((r) => r.w))];
  const rows = await inParts(ids, 250, (v) => `SELECT ?w ?wLabel ?sl ?a ?aLabel WHERE { VALUES ?w { ${v} } ?w wikibase:sitelinks ?sl; wdt:${prop} ?a.
    ${ru('?w')} ${lbl('?w', '?a')} }`);
  return single(rows, 'w', 'a');
}

/** people: country of citizenship and birth year, to pick wrong answers of the same country and time */
async function people(ids) {
  const info = new Map();
  for (const r of await inParts([...new Set(ids)], 300, (v) => `SELECT ?p ?c ?b ?sl WHERE { VALUES ?p { ${v} } ?p wikibase:sitelinks ?sl.
    OPTIONAL { ?p wdt:P27 ?c } OPTIONAL { ?p wdt:P569 ?b } }`)) {
    const p = info.get(r.p) ?? { countries: new Set(), year: null, sl: +r.sl };
    if (r.c) p.countries.add(r.c);
    if (r.b && !p.year) p.year = +r.b.slice(0, r.b.startsWith('-') ? 5 : 4);
    info.set(r.p, p);
  }
  return info;
}
const closeness = (a, b) => (a && b ? ([...a.countries].some((c) => b.countries.has(c)) ? 2 : 0)
  + (a.year && b.year && Math.abs(a.year - b.year) <= 60 ? 1 : 0) : 0);

export async function build() {
  const states = await loadStates();
  const out = [];

  // a work -> its person (author, painter, director, composer)
  // job: the answer and every wrong answer must have that occupation (no «Иисус Христос» or «Барак Обама» among the
  // writers of «Илиада», no actors among film directors)
  const byPerson = async ({ type, category, classes, prop, minSl, text, via, job, notForWrong = [] }) => {
    const { drafts, add } = collector(category);
    let rows = (await works(classes, prop, minSl, via)).filter((r) => goodSubject(unquote(r.wLabel)));
    const ofJob = new Set((await inParts([...new Set(rows.map((r) => r.a))], 300, (v) => `SELECT DISTINCT ?p WHERE { VALUES ?p { ${v} }
      ?p wdt:P106/wdt:P279* wd:${job}. }`)).map((r) => r.p));
    rows = rows.filter((r) => ofJob.has(r.a));
    // wrong answers only: nobody famous mainly for something else (Обама, Хокинг among writers; Рассел Кроу among directors)
    const elsewhere = notForWrong.length ? new Set((await inParts([...ofJob], 300, (v) => `SELECT DISTINCT ?p WHERE { VALUES ?p { ${v} }
      VALUES ?o { ${notForWrong.map((q) => 'wd:' + q).join(' ')} } ?p wdt:P106/wdt:P279* ?o. }`)).map((r) => r.p)) : new Set();
    const info = await people(rows.map((r) => r.a));
    const persons = new Map(rows.map((r) => [r.a, { id: r.a, label: noPatronymic(r.aLabel), sl: info.get(r.a)?.sl ?? 0 }]));
    for (const r of rows) {
      const me = info.get(r.a);
      const name = noPatronymic(r.aLabel);
      const cands = [...persons.values()].filter((p) => p.id !== r.a && !elsewhere.has(p.id)).map((p) => ({ ...p, score: closeness(me, info.get(p.id)) }));
      add(type, r.w, unquote(r.wLabel), +r.sl, text(unquote(r.wLabel)), name, pool(name, cands, undefined, undefined, r.w), { group: name });
    }
    out.push(...drafts);
  };
  await byPerson({ type: 'book_author', category: 'literature', minSl: 12, prop: 'P50', job: 'Q36180', notForWrong: ['Q82955', 'Q901', 'Q33999'],
    classes: 'wd:Q7725634 wd:Q8261 wd:Q5185279 wd:Q25379 wd:Q49084 wd:Q149537 wd:Q37484', text: (t) => `Кто написал «${t}»?` });
  await byPerson({ type: 'painting_author', category: 'art', minSl: 8, prop: 'P170', job: 'Q1028181', classes: 'wd:Q3305213', text: (t) => `Кто написал картину «${t}»?` });
  await byPerson({ type: 'film_director', category: 'movies', minSl: 25, prop: 'P57', job: 'Q2526255', notForWrong: ['Q33999', 'Q177220', 'Q82955'], classes: 'wd:Q11424', text: (t) => `Кто снял фильм «${t}»?` });
  // operas are marked by genre (P136), not by P31; ballets are found neither way
  await byPerson({ type: 'opera_composer', category: 'music', minSl: 8, prop: 'P86', job: 'Q36834', classes: 'wd:Q1344', via: 'wdt:P136', text: (t) => `Кто написал оперу «${t}»?` });

  // --- where a painting is kept (one collection only); other museums of the same country first
  {
    const { drafts, add } = collector('art');
    // museums only: not «Отдел живописи Лувра», «Версаль», «Капитолий»
    const all = (await works('wd:Q3305213', 'P195', 8)).filter((r) => goodSubject(unquote(r.wLabel)));
    const museumCountry = new Map((await inParts([...new Set(all.map((r) => r.a))], 300, (v) => `SELECT ?m ?c ?sl WHERE { VALUES ?m { ${v} }
      ?m wikibase:sitelinks ?sl; wdt:P31/wdt:P279* wd:Q33506. OPTIONAL { ?m wdt:P17 ?c } }`)).map((r) => [r.m, r]));
    const rows = all.filter((r) => museumCountry.has(r.a));
    const museums = new Map(rows.map((r) => [r.a, { id: r.a, label: r.aLabel, sl: +(museumCountry.get(r.a)?.sl ?? 0), c: museumCountry.get(r.a)?.c }]));
    for (const r of rows) {
      const m = museums.get(r.a);
      const cands = [...museums.values()].filter((o) => o.id !== m.id).map((o) => ({ ...o, score: o.c && o.c === m.c ? 1 : 0 }));
      add('painting_museum', r.w, unquote(r.wLabel), +r.sl, `Где хранится картина «${unquote(r.wLabel)}»?`, m.label, pool(m.label, cands), { group: m.label });
    }
    out.push(...drafts);
  }

  // --- the year a film came out (all its release dates in one year)
  {
    const { drafts, add } = collector('movies');
    const ids = [...new Set((await sparql(`SELECT ?w WHERE { ?w wdt:P31 wd:Q11424; wikibase:sitelinks ?sl. FILTER(?sl >= 25) }`)).map((r) => r.w))];
    const rows = await inParts(ids, 80, (v) => `SELECT ?w ?wLabel ?sl ?d WHERE { VALUES ?w { ${v} } ?w wikibase:sitelinks ?sl; wdt:P577 ?d.
      ${ru('?w')} ${lbl('?w')} }`);
    for (const r of single(rows.map((x) => ({ ...x, y: x.d.slice(0, 4) })), 'w', 'y')) {
      const y = +r.y;
      const t = unquote(r.wLabel);
      if (!goodSubject(t) || y < 1890 || y > YEAR_NOW) continue;
      add('film_year', r.w, t, +r.sl, `В каком году вышел фильм «${t}»?`, y, yearPool(y, r.w));
    }
    out.push(...drafts);
  }

  // --- the country a band comes from
  {
    const { drafts, add } = collector('music');
    const rows = single(await sparql(`SELECT ?b ?bLabel ?sl ?c WHERE { VALUES ?cls { wd:Q215380 wd:Q5741069 } ?b wdt:P31 ?cls; wikibase:sitelinks ?sl.
      FILTER(?sl >= 30) ?b wdt:P495 ?c. ${ru('?b')} ${lbl('?b')} }`), 'b', 'c');
    for (const r of rows) {
      const st = states.get(r.c);
      const t = unquote(r.bLabel);
      if (!st || !goodSubject(t, 50)) continue;
      add('band_country', r.b, t, +r.sl, `Из какой страны группа «${t}»?`, st.label, pool(st.label, countryCandidates(states, st)), { group: st.label });
    }
    out.push(...drafts);
  }
  return out;
}

if (process.argv[1]?.endsWith('build-culture.mjs')) {
  const d = await build();
  console.log(Object.entries(Object.groupBy(d, (x) => x.type)).map(([t, xs]) => `${t}: ${xs.length}`).join(', '));
}
