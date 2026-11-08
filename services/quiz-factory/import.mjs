// Final questions -> mao-dao quiz library (POST /internal/quizzes/import, see app/Http/Controllers/QuizImportController.php).
//   node import.mjs <final.json> [--dry-run] [--size=20] [--status=published|draft]
// One quiz per question type, split into parts of --size questions (key geo-<type>-<n>, so a re-run only adds new
// questions). Each question gets its correct answer + 3 wrong ones from its pool, and the whole pool goes to
// questions.wrong_pool (a round can pick other wrong answers from it).
// URL: QUIZ_IMPORT_URL (default https://mao-dao.com); secret: QUIZ_IMPORT_SECRET or ~/.mao-dao/quiz-import-secret.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=')[1];
const DRY = args.includes('--dry-run');
const SIZE = Number(opt('size', 20));
const STATUS = opt('status', 'published');
const URL_BASE = process.env.QUIZ_IMPORT_URL || 'https://mao-dao.com';
const secretFile = join(homedir(), '.mao-dao', 'quiz-import-secret');
const SECRET = process.env.QUIZ_IMPORT_SECRET || (existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : '');

const TITLES = {
  capital: ['Столицы мира', 'Угадайте столицу страны'],
  city_country: ['Города мира', 'В какой стране этот город?'],
  mountain_country: ['Горы мира', 'В какой стране эта вершина?'],
  elevation: ['Высота гор', 'Насколько высоки знаменитые вершины'],
  highest_point: ['Высшие точки стран', 'Самые высокие вершины разных стран'],
  river_mouth: ['Реки мира', 'Куда впадают великие реки'],
};

function pick3(q) {
  let h = [...q.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
  const pool = [...q.wrong];
  const out = [];
  while (out.length < 3) out.push(pool.splice((h = (h * 1103515245 + 12345) >>> 0) % pool.length, 1)[0]);
  return out;
}

const questions = JSON.parse(readFileSync(file, 'utf8'));
const byType = Object.groupBy(questions, (q) => q.type);
let added = 0;
for (const [type, qs] of Object.entries(byType)) {
  for (let part = 0; part * SIZE < qs.length; part++) {
    const chunk = qs.slice(part * SIZE, (part + 1) * SIZE);
    const [title, description] = TITLES[type] ?? [type, ''];
    const body = {
      key: `geo-${type.replace(/_/g, '-')}-${part + 1}`,
      title: `География: ${title}${part ? ` — ${part + 1}` : ''}`,
      description: `${description}. Факты из Wikidata.`,
      language: 'ru', tags: ['geography'], status: STATUS,
      questions: chunk.map((q) => ({ text: q.text, answers: [{ text: q.correct, is_correct: true }, ...pick3(q).map((t) => ({ text: t, is_correct: false }))], wrong_pool: q.wrong })),
    };
    if (DRY) { console.log(body.key, body.title, body.questions.length, JSON.stringify(body.questions[0])); continue; }
    if (!SECRET) throw new Error('no QUIZ_IMPORT_SECRET');
    const res = await fetch(`${URL_BASE}/internal/quizzes/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Internal-Secret': SECRET }, body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${body.key}: ${res.status} ${text.slice(0, 400)}`);
    const r = JSON.parse(text);
    added += r.added;
    console.log(`${body.key}: +${r.added} (skipped ${r.skipped}, total ${r.total}) ${r.url}`);
  }
}
if (!DRY) console.log('added', added);
