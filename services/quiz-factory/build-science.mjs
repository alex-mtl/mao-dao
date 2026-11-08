// Science questions from Wikidata (no model): export build().
//   «Какой химический элемент обозначается символом Fe?», «Нильс Бор — лауреат Нобелевской премии в какой области?»
// No "кто открыл или изобрёл" (P61): the data is too mixed («Часы — Лакайль», «Австралия — Янсзон»).
import { sparql, ru, lbl, cap, single, pool, goodSubject, collector, noPatronymic } from './lib/common.mjs';

const NOBEL = { Q38104: 'Физика', Q44585: 'Химия', Q80061: 'Физиология и медицина', Q37922: 'Литература', Q35637: 'Премия мира', Q47170: 'Экономика' };

export async function build() {
  const { drafts, add } = collector('science');

  // --- chemical elements by symbol; wrong answers: neighbours in the periodic table first
  {
    const rows = single(await sparql(`SELECT ?e ?eLabel ?sl ?sym ?z WHERE { ?e wdt:P31 wd:Q11344; wdt:P246 ?sym; wdt:P1086 ?z; wikibase:sitelinks ?sl.
      ${lbl('?e')} }`), 'e', 'sym');
    const els = rows.map((r) => ({ id: r.e, label: cap(r.eLabel), sym: r.sym, z: +r.z, sl: +r.sl })).filter((e) => e.z >= 1 && e.z <= 118);
    for (const e of els) {
      const cands = els.filter((o) => o !== e).map((o) => ({ label: o.label, sl: o.sl, score: -Math.abs(o.z - e.z) }));
      add('element_symbol', e.id, e.label, e.sl, `Какой химический элемент обозначается символом ${e.sym}?`, e.label, pool(e.label, cands));
    }
  }

  // --- Nobel laureates with exactly one Nobel prize: in which field (the other 5 fields are the wrong answers)
  {
    const rows = single(await sparql(`SELECT ?p ?pLabel ?sl ?prize WHERE { VALUES ?prize { ${Object.keys(NOBEL).map((q) => 'wd:' + q).join(' ')} }
      ?p wdt:P166 ?prize; wdt:P31 wd:Q5; wikibase:sitelinks ?sl. FILTER(?sl >= 25) ${ru('?p')} ${lbl('?p')} }`), 'p', 'prize');
    for (const r of rows) {
      const name = noPatronymic(r.pLabel);
      if (!goodSubject(name, 60)) continue;
      const field = NOBEL[r.prize];
      add('nobel_field', r.p, name, +r.sl, `${name} — лауреат Нобелевской премии в какой области?`, field,
        pool(field, Object.values(NOBEL).map((label) => ({ label }))), { group: field });
    }
  }
  return drafts;
}

if (process.argv[1]?.endsWith('build-science.mjs')) {
  const d = await build();
  console.log(Object.entries(Object.groupBy(d, (x) => x.type)).map(([t, xs]) => `${t}: ${xs.length}`).join(', '));
}
