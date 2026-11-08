// Geography questions from Wikidata (no model): export build() -> [{id, type, category, text, correct, wrong[14], popularity}]
// Quiz-show wording: «Столица Финляндии?», «Самая высокая вершина Австралии?», «Высота Монблана?»,
// «В какой стране находится Рио-де-Жанейро?», «Куда впадает Сена?», «Валюта Японии?», «Официальный язык Бразилии?».
// Only facts we can stand behind: Russian label + Russian Wikipedia article, exactly ONE best-rank value (disputed
// borders, two capitals, unsure heights drop out), current sovereign states. Wrong answers are of the same kind and
// surely wrong (rules below), the most plausible first.
import { countryGenitive, knownGenitive } from './lib/genitive.mjs';
import { sparql, goodLabel, ru, lbl, norm, cap, single, inParts, pool, numberPool, loadStates, sameContinent, countryCandidates, collector } from './lib/common.mjs';

export async function build() {
  const states = await loadStates();
  const stateLabels = new Set([...states.values()].map((s) => norm(s.label)));
  const { drafts, add } = collector('geography');
  const gen = (st) => countryGenitive(st.label);

  // --- capitals: big cities of the same country first («Столица Австралии? — Сидней»), then capitals of the continent
  {
    const rows = single(await sparql(`SELECT ?c ?cap ?capLabel ?capSl WHERE {
      ?c wdt:P31 wd:Q3624078; wdt:P36 ?cap. FILTER NOT EXISTS { ?c wdt:P576 [] }
      ?cap wikibase:sitelinks ?capSl. ${ru('?cap')} ${lbl('?cap')} }`), 'c', 'cap');
    const caps = rows.filter((r) => states.has(r.c)).map((r) => ({ state: states.get(r.c), label: r.capLabel, sl: +r.capSl }));
    // a country's other big cities, except any city that is or was its capital or seat (Абиджан, Тель-Авив, Алматы, Гаага...)
    const cities = await sparql(`SELECT ?c ?city ?cityLabel ?sl WHERE {
      VALUES ?cls { wd:Q515 wd:Q1637706 wd:Q200250 wd:Q1549591 } ?city wdt:P31 ?cls; wdt:P17 ?c; wikibase:sitelinks ?sl. FILTER(?sl >= 40)
      FILTER NOT EXISTS { ?c p:P36/ps:P36 ?city } FILTER NOT EXISTS { ?city p:P1376/ps:P1376 ?c }
      FILTER NOT EXISTS { ?city wdt:P31 wd:Q5119 } ${lbl('?city')} }`);
    const bigCities = new Map();
    for (const r of cities) {
      if (!bigCities.has(r.c)) bigCities.set(r.c, []);
      if (!bigCities.get(r.c).some((x) => x.label === r.cityLabel)) bigCities.get(r.c).push({ label: r.cityLabel, sl: +r.sl });
    }
    for (const c of caps) {
      const own = (bigCities.get(c.state.id) ?? []).sort((a, b) => b.sl - a.sl).slice(0, 4).map((x) => ({ ...x, score: 2 }));
      const others = caps.filter((o) => o !== c).map((o) => ({ label: o.label, sl: o.sl, score: sameContinent(o.state, c.state) ? 1 : 0 }));
      const g = gen(c.state);
      add('capital', c.state.id, c.state.label, c.state.sl, g ? `Столица ${g}?` : `Столица страны «${c.state.label}»?`, c.label, pool(c.label, [...own, ...others]));
    }
  }

  // --- highest point of a country
  {
    const rows = single(await sparql(`SELECT ?c ?hp ?hpLabel ?hpSl WHERE {
      ?c wdt:P31 wd:Q3624078; wdt:P610 ?hp. FILTER NOT EXISTS { ?c wdt:P576 [] }
      ?hp wikibase:sitelinks ?hpSl. ${ru('?hp')} ${lbl('?hp')} }`), 'c', 'hp');
    const hps = rows.filter((r) => states.has(r.c)).map((r) => ({ state: states.get(r.c), label: r.hpLabel, sl: +r.hpSl, id: r.hp }));
    for (const h of hps) {
      if (hps.some((o) => o !== h && o.id === h.id) || stateLabels.has(norm(h.label))) continue; // shared peak / "Кения"
      const g = gen(h.state);
      const cands = hps.filter((o) => o !== h && !stateLabels.has(norm(o.label))).map((o) => ({ label: o.label, sl: o.sl, score: sameContinent(o.state, h.state) ? 1 : 0 }));
      add('highest_point', h.state.id, h.state.label, h.state.sl, g ? `Самая высокая вершина ${g}?` : `Самая высокая вершина страны «${h.state.label}»?`, h.label, pool(h.label, cands));
    }
  }

  // --- which country a big city / a mountain is in
  const capitalLabels = new Set(drafts.filter((d) => d.type === 'capital').map((d) => norm(d.correct)));
  const countryOf = async (type, classes, minSl, text) => {
    const rows = single(await sparql(`SELECT ?x ?xLabel ?sl ?country WHERE {
      VALUES ?cls { ${classes} } ?x wdt:P31 ?cls; wikibase:sitelinks ?sl. FILTER(?sl >= ${minSl})
      ?x wdt:P17 ?country. ${ru('?x')} ${lbl('?x')} }`), 'x', 'country');
    for (const r of rows) {
      const st = states.get(r.country);
      if (!st || !goodLabel(r.xLabel, 60)) continue;
      if (type === 'city_country' && capitalLabels.has(norm(r.xLabel))) continue; // capitals have their own questions
      // a peak may sit on a border: neighbours are never wrong answers for a mountain
      const cands = countryCandidates(states, st, (o) => type === 'mountain_country' && st.neighbours.has(o.id));
      add(type, r.x, r.xLabel, +r.sl, text(r.xLabel), st.label, pool(st.label, cands));
    }
  };
  const MOUNTAINS = 'wd:Q8502 wd:Q8072 wd:Q169358 wd:Q207326';
  await countryOf('city_country', 'wd:Q515 wd:Q1637706 wd:Q200250 wd:Q1549591', 50, (x) => `В какой стране находится ${x}?`);
  await countryOf('mountain_country', MOUNTAINS, 20, (x) => `В какой стране находится ${stateLabels.has(norm(x)) ? 'гора ' : ''}${x.replace(/^Гора /, 'гора ')}?`);

  // --- elevation (metres, one best-rank value); "Высота Монблана?" only with a known genitive, else "Высота вершины X?"
  {
    const ids = [...new Set((await sparql(`SELECT ?m WHERE {
      VALUES ?cls { ${MOUNTAINS} } ?m wdt:P31 ?cls; wikibase:sitelinks ?sl. FILTER(?sl >= 25) ${ru('?m')} }`)).map((r) => r.m))];
    const rows = await inParts(ids, 250, (v) => `SELECT ?m ?mLabel ?sl ?e ?u WHERE { VALUES ?m { ${v} } ?m wikibase:sitelinks ?sl.
      ?m p:P2044 ?st. ?st a wikibase:BestRank; psv:P2044 [ wikibase:quantityAmount ?e; wikibase:quantityUnit ?u ]. ${lbl('?m')} }`);
    for (const r of single(rows.map((x) => ({ ...x, ev: `${x.e}|${x.u}` })), 'm', 'ev')) {
      if (r.u !== 'Q11573' || !goodLabel(r.mLabel, 60)) continue; // metres only
      const e = Math.round(+r.e);
      if (e < 500) continue;
      const name = r.mLabel.replace(/^[Гг]ора /, '');
      const g = knownGenitive(name);
      const text = stateLabels.has(norm(name)) ? `Высота горы ${name}?` : g ? `Высота ${g}?` : `Высота вершины ${name}?`;
      add('elevation', r.m, r.mLabel, +r.sl, text, `${e} м`, numberPool(e, r.m, { max: 8849, min: 100 }).map((x) => `${x} м`));
    }
  }

  // --- where a river flows into: never the bigger water the mouth is part of, no oceans unless the answer is one
  {
    const rows = single(await sparql(`SELECT ?r ?rLabel ?sl ?mouth ?mouthLabel ?mSl ?mIsRiver WHERE {
      ?r wdt:P31 wd:Q4022; wikibase:sitelinks ?sl; wdt:P403 ?mouth. FILTER(?sl >= 30)
      ?mouth wikibase:sitelinks ?mSl. FILTER(?mSl >= 25)
      BIND(EXISTS { ?mouth wdt:P31 wd:Q4022 } AS ?mIsRiver) ${ru('?r')} ${ru('?mouth')} ${lbl('?r', '?mouth')} }`), 'r', 'mouth');
    const parts = new Map();
    for (const r of await sparql(`SELECT ?m ?up WHERE { ?r wdt:P31 wd:Q4022; wikibase:sitelinks ?sl; wdt:P403 ?m. FILTER(?sl >= 30) ?m wdt:P361+ ?up. }`)) {
      if (!parts.has(r.m)) parts.set(r.m, new Set());
      parts.get(r.m).add(r.up);
    }
    const oceans = new Set((await sparql(`SELECT ?o WHERE { ?o wdt:P31 wd:Q9430 }`)).map((r) => r.o));
    const mouths = new Map();
    for (const r of rows) mouths.set(r.mouth, { id: r.mouth, label: r.mouthLabel, sl: +r.mSl, river: r.mIsRiver === 'true', ocean: oceans.has(r.mouth) });
    const related = (a, b) => parts.get(a.id)?.has(b.id) || parts.get(b.id)?.has(a.id);
    for (const r of rows) {
      if (!goodLabel(r.rLabel, 60)) continue;
      const m = mouths.get(r.mouth);
      const cands = [...mouths.values()].filter((o) => o !== m && !related(o, m) && (m.ocean || !o.ocean) && o.river === m.river);
      add('river_mouth', r.r, r.rLabel, +r.sl, `Куда впадает ${stateLabels.has(norm(r.rLabel)) ? 'река ' : ''}${r.rLabel}?`, m.label, pool(m.label, cands));
    }
  }

  // --- currency and official language: one value only; never a language also used in the country (каталанский в Испании)
  const byCountry = async (type, prop, minSl, text, extraExclude) => {
    const rows = single(await sparql(`SELECT ?c ?v ?vLabel ?vSl WHERE { ?c wdt:P31 wd:Q3624078; wdt:${prop} ?v. FILTER NOT EXISTS { ?c wdt:P576 [] }
      ?v wikibase:sitelinks ?vSl. ${ru('?v')} ${lbl('?v')} }`), 'c', 'v');
    const items = rows.filter((r) => states.has(r.c)).map((r) => ({ state: states.get(r.c), id: r.v, label: cap(r.vLabel), sl: +r.vSl }));
    const used = extraExclude ? await extraExclude() : new Map();
    for (const it of items) {
      const g = gen(it.state);
      if (!g) continue;
      const cands = items.filter((o) => o.id !== it.id && !(used.get(it.state.id)?.has(o.id)))
        .map((o) => ({ label: o.label, sl: o.sl, score: sameContinent(o.state, it.state) ? 1 : 0 }));
      add(type, it.state.id, it.state.label, it.state.sl, text(g), it.label, pool(it.label, cands));
    }
  };
  await byCountry('currency', 'P38', 0, (g) => `Валюта ${g}?`);
  await byCountry('language', 'P37', 0, (g) => `Официальный язык ${g}?`, async () => {
    const m = new Map();
    for (const r of await sparql(`SELECT ?c ?l WHERE { ?c wdt:P31 wd:Q3624078; wdt:P2936 ?l. }`)) {
      if (!m.has(r.c)) m.set(r.c, new Set());
      m.get(r.c).add(r.l);
    }
    return m;
  });

  return drafts;
}

if (process.argv[1]?.endsWith('build-geo.mjs')) {
  const d = await build();
  console.log(Object.entries(Object.groupBy(d, (x) => x.type)).map(([t, xs]) => `${t}: ${xs.length}`).join(', '));
}
