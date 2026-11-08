// Sport questions from Wikidata (no model): export build(). Wording needs no declension:
//   «Где прошла летняя Олимпиада-1980?», «Где прошёл чемпионат мира по футболу 2018 года?»,
//   «Кто выиграл чемпионат мира по футболу 2014 года?», «Майкл Фелпс — какой вид спорта?», «В какой стране играет «Ювентус»?»
// Same rules as geography: one best-rank value, Russian label + article, wrong answers of the same kind that are surely wrong.
import { sparql, goodLabel, ru, lbl, cap, single, inParts, pool, loadStates, countryCandidates, collector, noPatronymic, YEAR_NOW } from './lib/common.mjs';

export async function build() {
  const states = await loadStates();
  const { drafts, add } = collector('sports');
  const year = (label) => +(label.match(/\b(18|19|20)\d\d\b/) ?? [0])[0];

  // --- Olympic host cities (P3450 = summer / winter Games; P276 only if it is a settlement, not a venue)
  const hosts = [];
  for (const [series, kind] of [['Q159821', 'summer'], ['Q82414', 'winter']]) {
    const rows = single(await sparql(`SELECT ?e ?eLabel ?sl ?city ?cityLabel ?country WHERE { ?e wdt:P3450 wd:${series}; wikibase:sitelinks ?sl; wdt:P276 ?city.
      FILTER EXISTS { ?city wdt:P31/wdt:P279* wd:Q486972 } OPTIONAL { ?city wdt:P17 ?country } ${lbl('?e', '?city')} }`), 'e', 'city');
    for (const r of rows) hosts.push({ ...r, kind, cityLabel: r.cityLabel.replace(/^Горнолыжный курорт /, ''), year: year(r.eLabel) });
  }
  // wrong answers beyond other hosts: big cities of countries that never hosted the Games (no "partly true" city like
  // Таллин for 1980, where the regatta was)
  const hostCountries = new Set(hosts.map((h) => h.country).filter(Boolean));
  const bigCities = (await sparql(`SELECT ?city ?cityLabel ?sl ?c WHERE { VALUES ?cls { wd:Q515 wd:Q1637706 wd:Q200250 }
    ?city wdt:P31 ?cls; wdt:P17 ?c; wikibase:sitelinks ?sl. FILTER(?sl >= 150) ${lbl('?city')} }`))
    .filter((r) => !hostCountries.has(r.c)).map((r) => ({ label: r.cityLabel, sl: +r.sl, score: 0 }));
  for (const h of hosts) {
    if (!h.year || h.year > YEAR_NOW || hosts.some((o) => o !== h && o.kind === h.kind && o.year === h.year)) continue;
    const sameKind = hosts.filter((o) => o.kind === h.kind && o.cityLabel !== h.cityLabel).map((o) => ({ label: o.cityLabel, sl: +o.sl, score: 2 }));
    const otherKind = hosts.filter((o) => o.kind !== h.kind && o.cityLabel !== h.cityLabel).map((o) => ({ label: o.cityLabel, sl: +o.sl, score: 1 }));
    add(`olympics_${h.kind}`, h.e, h.eLabel, +h.sl, `Где прошла ${h.kind === 'summer' ? 'летняя' : 'зимняя'} Олимпиада-${h.year}?`, h.cityLabel,
      pool(h.cityLabel, [...sameKind, ...otherKind, ...bigCities]));
  }

  // --- football: World Cup (Q19317) and Euro (Q260858) hosts and winners (winner = the national team's country)
  for (const [series, name, key] of [['Q19317', 'чемпионат мира по футболу', 'wc'], ['Q260858', 'чемпионат Европы по футболу', 'euro']]) {
    const rows = await sparql(`SELECT ?e ?eLabel ?sl ?host ?win ?winCountry WHERE { ?e wdt:P3450 wd:${series}; wikibase:sitelinks ?sl.
      OPTIONAL { ?e wdt:P17 ?host } OPTIONAL { ?e wdt:P1346 ?win. OPTIONAL { ?win wdt:P17 ?winCountry } } ${lbl('?e')} }`);
    const hostRows = single(rows, 'e', 'host').filter((r) => states.has(r.host) && year(r.eLabel) && year(r.eLabel) <= YEAR_NOW);
    const winRows = single(single(rows, 'e', 'win'), 'e', 'winCountry').filter((r) => states.has(r.winCountry) && year(r.eLabel));
    const nations = [...new Set([...hostRows.map((r) => r.host), ...winRows.map((r) => r.winCountry)])].map((id) => ({ ...states.get(id), score: 2 }));
    for (const r of hostRows) {
      const st = states.get(r.host);
      add(`${key}_host`, r.e, r.eLabel, +r.sl, `Где прошёл ${name} ${year(r.eLabel)} года?`, st.label, pool(st.label, [...nations, ...countryCandidates(states, st)]));
    }
    for (const r of winRows) {
      const st = states.get(r.winCountry);
      add(`${key}_winner`, r.e, r.eLabel, +r.sl, `Кто выиграл ${name} ${year(r.eLabel)} года?`, st.label, pool(st.label, [...nations, ...countryCandidates(states, st)]));
    }
  }

  // --- famous sportspeople and their (single) sport: athletes by occupation, not famous for anything else
  {
    const ids = (await sparql(`SELECT ?p WHERE { ?p wdt:P641 []; wikibase:sitelinks ?sl. FILTER(?sl >= 60) ?p wdt:P31 wd:Q5. }`)).map((r) => r.p);
    const rows = await inParts(ids, 300, (v) => `SELECT ?p ?pLabel ?sl ?sport ?sportLabel WHERE { VALUES ?p { ${v} }
      ?p wikibase:sitelinks ?sl; wdt:P641 ?sport. ${ru('?p')} ${lbl('?p', '?sport')} }`);
    const athletes = new Set((await inParts(ids, 300, (v) => `SELECT DISTINCT ?p WHERE { VALUES ?p { ${v} } ?p wdt:P106 ?job. ?job wdt:P279* wd:Q2066131. }`)).map((r) => r.p));
    // Нильс Бор kept goal, Камю too, Буш played rugby, Пий XI climbed: politicians, writers, scientists, artists, clergy... are out
    const OTHER_FAME = 'wd:Q82955 wd:Q36180 wd:Q901 wd:Q483501 wd:Q33999 wd:Q639669 wd:Q131524 wd:Q81096 wd:Q189290 wd:Q4964182 wd:Q1930187 wd:Q2526255 wd:Q2259532 wd:Q250867';
    const famousElse = new Set((await inParts(ids, 300, (v) => `SELECT DISTINCT ?p WHERE { VALUES ?p { ${v} } VALUES ?fame { ${OTHER_FAME} }
      ?p wdt:P106 ?job. ?job wdt:P279* ?fame. }`)).map((r) => r.p));
    const people = single(rows.filter((r) => athletes.has(r.p) && !famousElse.has(r.p)), 'p', 'sport');
    const count = new Map();
    for (const r of people) count.set(cap(r.sportLabel), (count.get(cap(r.sportLabel)) ?? 0) + 1);
    const sports = [...count.entries()].map(([label, n]) => ({ label, sl: n }));
    for (const r of people) {
      const name = noPatronymic(r.pLabel);
      if (!goodLabel(name, 60) || name.split(' ').length < 2) continue; // nicknames are often ambiguous
      add('athlete_sport', r.p, name, +r.sl, `${name} — какой вид спорта?`, cap(r.sportLabel), pool(cap(r.sportLabel), sports), { group: cap(r.sportLabel) });
    }
  }

  // --- football clubs and their country
  {
    const rows = single(await sparql(`SELECT ?c ?cLabel ?sl ?country WHERE { ?c wdt:P31 wd:Q476028; wikibase:sitelinks ?sl. FILTER(?sl >= 30)
      ?c wdt:P17 ?country. ${ru('?c')} ${lbl('?c')} }`), 'c', 'country');
    // «Динамо», «Жальгирис»: a name shared by several clubs makes the question ambiguous
    const named = Object.groupBy(await sparql(`SELECT ?c ?cLabel WHERE { ?c wdt:P31 wd:Q476028. ${lbl('?c')} }`), (r) => r.cLabel);
    for (const r of rows) {
      const st = states.get(r.country);
      if (!st || !goodLabel(r.cLabel, 40) || (named[r.cLabel]?.length ?? 0) > 1) continue;
      add('club_country', r.c, r.cLabel, +r.sl, `В какой стране играет «${r.cLabel}»?`, st.label, pool(st.label, countryCandidates(states, st)), { group: st.label });
    }
  }
  return drafts;
}

if (process.argv[1]?.endsWith('build-sport.mjs')) {
  const d = await build();
  console.log(Object.entries(Object.groupBy(d, (x) => x.type)).map(([t, xs]) => `${t}: ${xs.length}`).join(', '));
}
