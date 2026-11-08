// data/plan.json -> one HTML page: a summary by category and level, then every quiz (folded) with its questions:
// question, correct answer, the 3 wrong ones in the quiz, the 11 spare ones.   node report-plan.mjs [data/plan.json] [out.html]
import { readFileSync, writeFileSync } from 'node:fs';

const [file = 'data/plan.json', out = 'data/report-all.html'] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(file, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const CAT = { geography: 'География', sports: 'Спорт', literature: 'Литература', art: 'Искусство', movies: 'Кино', music: 'Музыка', science: 'Наука', history: 'История' };
const level = (k) => (k.includes('-easy-') ? 'лёгкий' : k.includes('-medium-') ? 'средний' : k.includes('-hard-') ? 'сложный' : 'первые пакеты');

const sum = {};
for (const q of plan) {
  const s = (sum[q.tag] ??= {});
  const l = level(q.key);
  s[l] = s[l] ?? { quizzes: 0, questions: 0 };
  s[l].quizzes++;
  s[l].questions += q.questions.length;
}
const levels = ['лёгкий', 'средний', 'сложный', 'первые пакеты'];
const total = plan.reduce((n, q) => n + q.questions.length, 0);
const sumRows = Object.entries(sum).map(([tag, s]) => `<tr><td>${CAT[tag] ?? tag}</td>${levels.map((l) => `<td>${s[l] ? `${s[l].questions} <small>(${s[l].quizzes})</small>` : ''}</td>`).join('')}`
  + `<td><b>${Object.values(s).reduce((n, x) => n + x.questions, 0)}</b></td></tr>`).join('');

const quizzes = plan.map((q) => `<details><summary>${esc(q.title)} <small>· ${q.questions.length} · ${esc(q.key)}</small></summary>
<p class="d">${esc(q.description)}</p><table><thead><tr><th>Вопрос</th><th>Верный</th><th>Неверный 1</th><th>Неверный 2</th><th>Неверный 3</th><th>Запас</th></tr></thead><tbody>
${q.questions.map((x) => `<tr><td>${esc(x.text)}</td><td class="ok">${esc(x.correct)}</td>${x.wrong.slice(0, 3).map((w) => `<td>${esc(w)}</td>`).join('')}<td class="d">${esc(x.wrong.slice(3).join(', '))}</td></tr>`).join('\n')}
</tbody></table></details>`).join('\n');

writeFileSync(out, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Квизы mao-dao</title><style>
:root{--bg:#fbfaf7;--fg:#1f2430;--muted:#6b7080;--line:#e4e1d8;--ok:#e6f4ea;--okfg:#1e6b35}
@media (prefers-color-scheme:dark){:root{--bg:#16181d;--fg:#e8e6e1;--muted:#9a9eab;--line:#2c2f37;--ok:#173322;--okfg:#7fd69a}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}h1{font-size:20px;margin:0 0 8px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
td.ok{background:var(--ok);color:var(--okfg);font-weight:600}.d,small{color:var(--muted)}td.d{font-size:12px}
details{border-bottom:1px solid var(--line);padding:6px 0}summary{cursor:pointer;font-weight:600}.wrap{overflow-x:auto}.sum{max-width:760px;margin-bottom:20px}
</style></head><body><h1>Квизы mao-dao: ${total} вопросов, ${plan.length} квизов</h1>
<p class="d">Всё из Wikidata, без генерации моделью. В каждом новом квизе 20 вопросов одной категории и одного уровня, типы вперемешку.
У вопроса 3 неверных ответа в квизе и до 11 запасных для смены вариантов в игре.</p>
<div class="wrap sum"><table><thead><tr><th>Категория</th>${levels.map((l) => `<th>${l} <small>(квизов)</small></th>`).join('')}<th>Всего</th></tr></thead><tbody>${sumRows}</tbody></table></div>
<div class="wrap">${quizzes}</div></body></html>`);
console.log('->', out, total, 'questions');
