// Pilot report: every draft as a table row (question, correct + 3 wrong answers as imported, comment).
//   node report.mjs <drafts.json> <kaggle result.json> <final.json> [import log] [out.html]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [draftsFile, resultFile, finalFile, importLog = 'data/import-pilot.log', out = 'data/report-pilot.html'] = process.argv.slice(2);
const drafts = JSON.parse(readFileSync(draftsFile, 'utf8'));
const res = JSON.parse(readFileSync(resultFile, 'utf8'));
const final = new Map(JSON.parse(readFileSync(finalFile, 'utf8')).map((q) => [q.id, q]));
const items = new Map(res.items.map((i) => [i.id, i]));
const links = existsSync(importLog) ? [...readFileSync(importLog, 'utf8').matchAll(/^(geo-[\w-]+): .*?(https:\S+)/gm)].map((m) => [m[1], m[2]]) : [];

// same choice of 3 wrong answers as import.mjs
function pick3(q) {
  let h = [...q.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
  const pool = [...q.wrong];
  const o = [];
  while (o.length < 3) o.push(pool.splice((h = (h * 1103515245 + 12345) >>> 0) % pool.length, 1)[0]);
  return o;
}

// my own notes on particular questions (subject -> note), on top of the automatic ones
const NOTES = {
  'capital:Турция': 'Хорошая ловушка: многие ответят «Стамбул» (его нет среди вариантов: столица выбирается из столиц).',
  'capital:Австралия': 'Ловушка: многие думают «Сидней».',
  'capital:Канада': 'Ловушка: многие думают «Торонто».',
  'capital:США': 'Вариант «Вашингтон» не путается со штатом: в вопросе речь о городе.',
  'city_country:Гонконг': 'Особый административный район КНР: ответ «Китай» корректен.',
  'mountain_country:Чогори': 'Вершина на границе Пакистана и Китая: соседние страны (Китай, Индия, Афганистан…) убраны из вариантов, поэтому вопрос однозначный.',
  'mountain_country:Арарат': 'Символ Армении, но находится в Турции: отличный вопрос-ловушка.',
  'mountain_country:Гора Рашмор': 'Скорее известна как монумент, но это гора; формулировка поправлена на «гора Рашмор».',
  'mountain_country:Синай': 'Гора Синай (Муса) на Синайском полуострове: ответ «Египет» верен.',
  'highest_point:США': 'Мак-Кинли в 2015–2025 официально называлась «Денали», в 2025 имя вернули. Часть игроков знает её как Денали.',
  'highest_point:Австралия': 'Выброшено ПРАВИЛЬНО: Моусон стоит на острове Херд (внешняя территория), а на материке высшая точка — гора Косцюшко. Спорный факт, фильтр сработал.',
  'river_mouth:Евфрат': 'Верно, но сложно: многие ответят «Персидский залив» (его нет среди вариантов).',
  'river_mouth:Тигр': 'Верно, но сложно: многие ответят «Персидский залив» (его нет среди вариантов).',
  'river_mouth:Ганг': 'Индийский океан убран из вариантов: залив — его часть, иначе было бы два верных ответа.',
  'river_mouth:Висла': 'Балтийское море убрано из вариантов: Гданьский залив — его часть.',
  'river_mouth:Нил': 'Средиземное море — часть бассейна Атлантики, поэтому океаны в варианты для рек, впадающих в моря, не ставятся.',
};
const MODEL_WRONG = 'Факт верный (Wikidata), ошиблась проверяющая модель 7B. Вопрос потерян зря.';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const TYPE = { capital: 'Столицы', city_country: 'Города', mountain_country: 'Горы → страна', elevation: 'Высота гор', highest_point: 'Высшие точки', river_mouth: 'Реки → устье' };
let rows = '';
let lastType = '';
for (const d of drafts) {
  const it = items.get(d.id);
  const q = final.get(d.id);
  const key = `${d.type}:${d.subject}`;
  let status;
  let text;
  let wrong;
  const notes = [];
  if (q) {
    status = 'ok';
    text = q.text;
    wrong = pick3(q);
    if (q.polish_rejected) notes.push(`Модель переписала неудачно («${q.polish_rejected}»), оставлен шаблон.`);
  } else {
    status = 'drop';
    text = it.polished || d.template;
    wrong = it.options.filter((o) => o !== d.correct);
    const said = it.options['ABCD'.indexOf(it.model_answer)] ?? it.model_answer;
    notes.push(`<b>Не загружен</b>: модель ответила «${esc(said)}».`);
    if (!NOTES[key]) notes.push(MODEL_WRONG);
  }
  if (NOTES[key]) notes.push(NOTES[key]);
  if (d.type === 'elevation' && q) notes.push('Варианты отличаются от верного минимум на 6%: вопрос для знатоков.');
  if (d.type !== lastType) {
    rows += `<tr class="group"><td colspan="6">${TYPE[d.type] ?? d.type}</td></tr>`;
    lastType = d.type;
  }
  rows += `<tr class="${status}"><td class="q"><a href="https://www.wikidata.org/wiki/${d.subject_qid}" target="_blank">${esc(text)}</a></td>`
    + `<td class="correct">${esc(d.correct)}</td>${wrong.map((w) => `<td>${esc(w)}</td>`).join('')}`
    + `<td class="note">${notes.join(' ')}</td></tr>`;
}

const kept = final.size;
const s = res.seconds;
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Пилот: география</title><style>
:root{--bg:#fbfaf7;--fg:#1f2430;--muted:#6b7080;--line:#e4e1d8;--ok:#e6f4ea;--okfg:#1e6b35;--drop:#fbeaea;--dropfg:#9b2c2c;--group:#efece4}
@media (prefers-color-scheme:dark){:root{--bg:#16181d;--fg:#e8e6e1;--muted:#9a9eab;--line:#2c2f37;--ok:#173322;--okfg:#7fd69a;--drop:#3a1d1d;--dropfg:#f0a0a0;--group:#22252c}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
h1{font-size:20px;margin:0 0 8px}.sum{color:var(--muted);margin:0 0 4px}.sum b{color:var(--fg)}
.links a{color:inherit;margin-right:12px}.wrap{overflow-x:auto;margin-top:16px}
table{border-collapse:collapse;width:100%;min-width:900px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{position:sticky;top:0;background:var(--bg);font-weight:600}tr.group td{background:var(--group);font-weight:600}
td.q a{color:inherit;text-decoration:none}td.q{min-width:240px}td.note{color:var(--muted);min-width:260px}
tr.ok td.correct{background:var(--ok);color:var(--okfg);font-weight:600}tr.drop td{opacity:.8}tr.drop td.q{text-decoration:line-through}
tr.drop td.correct{background:var(--drop);color:var(--dropfg);font-weight:600}td.note b{color:var(--dropfg)}
</style></head><body>
<h1>Пилот генератора вопросов: география</h1>
<p class="sum">Черновиков <b>${drafts.length}</b> → загружено на mao-dao <b>${kept}</b>, выброшено <b>${drafts.length - kept}</b>.
Kaggle ${esc(res.gpus.join(' + '))}, ${esc(res.model)} (${res.mode}): загрузка модели ${s.load} с, переписывание ${s.polish} с, проверка ${s.verify} с.</p>
<p class="sum">Зелёным — верный ответ (в игре варианты перемешиваются). Зачёркнутые строки не загружены. Наведите на вопрос: ссылка на факт в Wikidata.</p>
<p class="sum links">${links.map(([k, u]) => `<a href="${u}" target="_blank">${k}</a>`).join('')}</p>
<div class="wrap"><table><thead><tr><th>Вопрос</th><th>Верный</th><th>Неверный 1</th><th>Неверный 2</th><th>Неверный 3</th><th>Комментарий</th></tr></thead>
<tbody>${rows}</tbody></table></div></body></html>`;
writeFileSync(out, html);
console.log('->', out);
