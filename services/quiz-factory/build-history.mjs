// History questions from Wikidata (no model): export build().
//   «Бородинское сражение — в каком году?», «Тридцатилетняя война» — год начала?
// A year is taken only when every date of the property falls into one year.
import { sparql, ru, lbl, cap, single, inParts, goodSubject, collector, yearPool, YEAR_NOW } from './lib/common.mjs';

async function years(cls, prop, minSl) {
  const ids = [...new Set((await sparql(`SELECT ?x WHERE { ?x wdt:P31 wd:${cls}; wikibase:sitelinks ?sl. FILTER(?sl >= ${minSl}) }`)).map((r) => r.x))];
  const rows = await inParts(ids, 250, (v) => `SELECT ?x ?xLabel ?sl ?d WHERE { VALUES ?x { ${v} } ?x wikibase:sitelinks ?sl; wdt:${prop} ?d.
    FILTER(DATATYPE(?d) = xsd:dateTime) ${ru('?x')} ${lbl('?x')} }`);
  // BCE dates start with "-": skipped (a quiz about "в каком году до н. э." needs other wording)
  return single(rows.filter((r) => !r.d.startsWith('-')).map((r) => ({ ...r, y: r.d.slice(0, 4) })), 'x', 'y').map((r) => ({ ...r, y: +r.y }));
}

export async function build() {
  const { drafts, add } = collector('history');
  for (const r of await years('Q178561', 'P585', 20)) { // battles
    if (!goodSubject(r.xLabel, 90) || r.y < 500 || r.y > YEAR_NOW) continue;
    add('battle_year', r.x, r.xLabel, +r.sl, `${cap(r.xLabel)} — в каком году?`, r.y, yearPool(r.y, r.x));
  }
  // wars: finished ones only (an end date) - no ongoing or disputed-start conflicts
  const ended = new Set((await sparql(`SELECT DISTINCT ?x WHERE { ?x wdt:P31 wd:Q198; wdt:P582 []; wikibase:sitelinks ?sl. FILTER(?sl >= 20) }`)).map((r) => r.x));
  for (const r of await years('Q198', 'P580', 20)) {
    if (!ended.has(r.x) || !goodSubject(r.xLabel, 90) || r.y < 500 || r.y > YEAR_NOW) continue;
    add('war_start', r.x, r.xLabel, +r.sl, `«${cap(r.xLabel)}» — год начала?`, r.y, yearPool(r.y, r.x));
  }
  // no "год основания города": Wikidata often has the first mention or a modern re-founding (Берлин 1244, Ашкелон 1948)
  return drafts;
}

if (process.argv[1]?.endsWith('build-history.mjs')) {
  const d = await build();
  console.log(Object.entries(Object.groupBy(d, (x) => x.type)).map(([t, xs]) => `${t}: ${xs.length}`).join(', '));
}
