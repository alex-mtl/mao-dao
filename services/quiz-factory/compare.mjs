// Two Kaggle runs on the same drafts side by side: wording and blind answers vs Wikidata.
//   node compare.mjs <drafts.json> <run A.json> <run B.json> [out.html]
import { readFileSync, writeFileSync } from 'node:fs';

const [draftsFile, aFile, bFile, out = 'data/compare.html'] = process.argv.slice(2);
const drafts = JSON.parse(readFileSync(draftsFile, 'utf8'));
const runs = [aFile, bFile].map((f) => JSON.parse(readFileSync(f, 'utf8')));
const maps = runs.map((r) => new Map(r.items.map((i) => [i.id, i])));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
const KEY_WORD = { capital: 'столиц', city_country: 'находится', mountain_country: 'находится', elevation: 'высот', highest_point: 'высш', river_mouth: 'впадает' };
const keepsSubject = (t, subj) => norm(subj).split(/[\s-]+/).filter((w) => w.length >= 4 && w !== 'гора').every((w) => norm(t).includes(w.slice(0, Math.min(4, w.length - 1))));
const wordingOk = (p, d) => !!p && p.endsWith('?') && p.length <= 150 && !norm(p).includes(norm(d.correct)) && keepsSubject(p, d.subject) && norm(p).includes(KEY_WORD[d.type])
  && !/[a-z]/i.test(p.replace(/[A-Z]{2,}/g, '')) && !/ — (город|вершина)/.test(p);

const both = drafts.filter((d) => maps.every((m) => m.has(d.id)));
const stats = runs.map(() => ({ right: 0, wording: 0, byType: {} }));
let rows = '';
for (const d of both) {
  const cells = maps.map((m, i) => {
    const it = m.get(d.id);
    const right = it.model_answer === it.key;
    const ok = it.genitive_ok !== false;
    const st = stats[i];
    st.right += right;
    st.wording += ok;
    st.byType[d.type] ??= [0, 0];
    st.byType[d.type][0] += right;
    st.byType[d.type][1]++;
    const said = it.options['ABCD'.indexOf(it.model_answer)] ?? it.model_answer;
    return `<td class="${ok ? '' : 'bad'}">${esc(it.text)}${it.genitive_ok === false ? ` <small>(${esc(d.gen_of)} → ${esc(it.genitive)})</small>` : ''}</td><td class="${right ? 'yes' : 'no'}">${right ? '✓' : esc(said)}</td>`;
  });
  rows += `<tr><td>${esc(d.subject)}</td><td>${esc(d.correct)}</td>${cells.join('')}</tr>`;
}
const name = (r) => r.model.split('/').pop();
const summary = runs.map((r, i) => `<li><b>${esc(name(r))}</b> (${r.mode}): ответил верно ${stats[i].right}/${both.length}, `
  + `склонение без ошибок ${stats[i].wording}/${both.length}; загрузка ${r.seconds.load} с, склонение ${r.seconds.genitive} с, проверка ${r.seconds.verify} с. `
  + `По типам: ${Object.entries(stats[i].byType).map(([t, [a, n]]) => `${t} ${a}/${n}`).join(', ')}</li>`).join('');
writeFileSync(out, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Qwen и GigaChat</title><style>
:root{--bg:#fbfaf7;--fg:#1f2430;--muted:#6b7080;--line:#e4e1d8;--yes:#1e6b35;--no:#9b2c2c;--bad:#fbeaea}
@media (prefers-color-scheme:dark){:root{--bg:#16181d;--fg:#e8e6e1;--muted:#9a9eab;--line:#2c2f37;--yes:#7fd69a;--no:#f0a0a0;--bad:#3a1d1d}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}h1{font-size:20px;margin:0 0 8px}
li{margin-bottom:4px}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:900px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:var(--bg)}
td.yes{color:var(--yes);font-weight:600}td.no{color:var(--no);font-weight:600}td.bad{background:var(--bad)}
</style></head><body><h1>Одни и те же ${both.length} вопросов: ${runs.map((r) => esc(name(r))).join(' и ')}</h1><ul>${summary}</ul>
<p style="color:var(--muted)">Розовая ячейка: модель неверно склонила название (в скобках), в игру идёт запасная формулировка без склонения. «✓» — модель вслепую выбрала ответ из Wikidata; иначе показано, что она выбрала.</p>
<div class="wrap"><table><thead><tr><th>Тема</th><th>Wikidata</th>${runs.map((r) => `<th>${esc(name(r))}: вопрос</th><th>ответ</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></body></html>`);
console.log(runs.map((r, i) => `${name(r)}: right ${stats[i].right}/${both.length}, wording ${stats[i].wording}/${both.length}`).join('\n'), '\n->', out);
