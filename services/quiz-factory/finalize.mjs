// Drafts + the Kaggle result -> final questions and a report of what was dropped and why.
//   node finalize.mjs <drafts.json> <data/kaggle/quiz-<run>.json> [out.json]
// Dropped: the model answered differently from Wikidata (a doubtful or badly worded question).
// The model's wording is used only if it passes checks; otherwise the template text (clunky but exact) stays.
import { readFileSync, writeFileSync } from 'node:fs';

const [draftsFile, resultFile, out = 'data/geo-final.json'] = process.argv.slice(2);
const drafts = new Map(JSON.parse(readFileSync(draftsFile, 'utf8')).map((d) => [d.id, d]));
const res = JSON.parse(readFileSync(resultFile, 'utf8'));
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');

/** every word of the subject (4+ letters) must still be there, its first 4 letters at least (declension changes endings) */
function keepsSubject(text, subject) {
  const t = norm(text);
  return norm(subject).split(/[\s-]+/).filter((w) => w.length >= 4 && w !== 'гора').every((w) => t.includes(w.slice(0, Math.min(4, w.length - 1))));
}

// the word that carries the question's meaning must survive the rewording ("впадет" / "В какой стране — город" fall back)
const KEY_WORD = { capital: 'столиц', city_country: 'находится', mountain_country: 'находится', elevation: 'высот', highest_point: 'высш', river_mouth: 'впадает' };

const final = [];
const dropped = [];
const stats = { total: res.items.length, kept: 0, dropped_model_disagrees: 0, polish_used: 0, polish_rejected: 0 };
for (const it of res.items) {
  const d = drafts.get(it.id);
  if (it.model_answer !== it.key) {
    stats.dropped_model_disagrees++;
    dropped.push({ id: it.id, question: it.polished || d.template, correct: d.correct, model_said: it.options['ABCD'.indexOf(it.model_answer)] ?? it.model_answer });
    continue;
  }
  const p = (it.polished || '').trim();
  const ok = p.endsWith('?') && p.length >= 10 && p.length <= 150 && !norm(p).includes(norm(d.correct)) && keepsSubject(p, d.subject)
    && norm(p).includes(KEY_WORD[d.type]) && !/[a-z]/i.test(p.replace(/[A-Z]{2,}/g, '')) && !/ — (город|вершина)/.test(p);
  ok ? stats.polish_used++ : stats.polish_rejected++;
  // "вершина Гора Рашмор" -> "гора Рашмор" (the label itself starts with "Гора")
  const text = (ok ? p : d.template).replace(/вершин[аы] Гора /, (m) => (m.endsWith('ы Гора ') ? 'горы ' : 'гора ')).replace(/ Гора /, ' гора ');
  final.push({ id: d.id, type: d.type, category: 'geography', text, correct: d.correct, wrong: d.wrong,
    source: `https://www.wikidata.org/wiki/${d.subject_qid}`, ...(ok ? {} : { polish_rejected: p }) });
  stats.kept++;
}
writeFileSync(out, JSON.stringify(final, null, 1));
console.log({ ...stats, model: res.model, mode: res.mode, gpus: res.gpus, seconds: res.seconds, tokens: res.tokens });
console.log('\ndropped (model disagrees):');
for (const x of dropped) console.log(` - ${x.question}  [Wikidata: ${x.correct}; модель: ${x.model_said}]`);
console.log('\npolish rejected:');
for (const x of final.filter((f) => f.polish_rejected)) console.log(` - "${x.polish_rejected}"  -> template`);
console.log(`\n-> ${out}`);
