// data/plan.json (plan.mjs) -> mao-dao quiz library, POST /internal/quizzes/import (app/Http/Controllers/QuizImportController.php)
//   node import.mjs [data/plan.json] [--dry-run] [--only=<quiz key prefix>] [--status=published|draft]
// One request per quiz. Each question: answers = the correct one + the first 3 of its pool; wrong_pool = all 14
// (the first 3 are the same as in answers). The API finds a question again by its key, keeps its answers and
// refreshes text and pool, so a re-run is safe.
// URL: QUIZ_IMPORT_URL (default https://mao-dao.com); secret: QUIZ_IMPORT_SECRET or ~/.mao-dao/quiz-import-secret.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? 'data/plan.json';
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `=${d}`).split('=')[1];
const DRY = args.includes('--dry-run');
const ONLY = opt('only', '');
const STATUS = opt('status', 'published');
const URL_BASE = process.env.QUIZ_IMPORT_URL || 'https://mao-dao.com';
const secretFile = join(homedir(), '.mao-dao', 'quiz-import-secret');
const SECRET = process.env.QUIZ_IMPORT_SECRET || (existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : '');

const quizzes = JSON.parse(readFileSync(file, 'utf8')).filter((q) => q.key.startsWith(ONLY));
const total = { added: 0, updated: 0, skipped: 0, quizzes: 0 };
for (const quiz of quizzes) {
  const body = {
    key: quiz.key, title: quiz.title, description: quiz.description, language: 'ru', tags: [quiz.tag], status: STATUS,
    questions: quiz.questions.map((q) => ({
      key: q.key, text: q.text, wrong_pool: q.wrong,
      answers: [{ text: q.correct, is_correct: true }, ...q.wrong.slice(0, 3).map((t) => ({ text: t, is_correct: false }))],
    })),
  };
  if (DRY) { console.log(quiz.key, quiz.title, body.questions.length, JSON.stringify(body.questions[0])); continue; }
  if (!SECRET) throw new Error('no QUIZ_IMPORT_SECRET');
  const res = await fetch(`${URL_BASE}/internal/quizzes/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Internal-Secret': SECRET }, body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${quiz.key}: ${res.status} ${text.slice(0, 600)}`);
  const r = JSON.parse(text);
  for (const k of ['added', 'updated', 'skipped']) total[k] += r[k];
  total.quizzes++;
  if (total.quizzes % 25 === 0) console.log(`${total.quizzes}/${quizzes.length} quizzes, +${total.added}, updated ${total.updated}`);
}
if (!DRY) console.log('done', total);
