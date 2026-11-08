// Drafts + one model's Kaggle result -> final questions (ALL of them, nothing is dropped - owner's decision 2026-11-08).
//   node finalize.mjs <drafts.json> <data/kaggle/quiz-<run>-<model>.json> [out.json] [--previous=data/geo-final-v1.json]
// The wording is the drafts' template with the model's genitive (checked on Kaggle); without a good genitive the
// fallback text stays. When the model answers differently from Wikidata the question stays, marked model_disagrees.
// --previous: an earlier final file; its wording goes along as previous_text, so the import rewords questions
// that are already on the site instead of adding copies.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const [draftsFile, resultFile, out = 'data/geo-final.json'] = args.filter((a) => !a.startsWith('--'));
const prevFile = (args.find((a) => a.startsWith('--previous=')) ?? '').slice(11);
const drafts = new Map(JSON.parse(readFileSync(draftsFile, 'utf8')).map((d) => [d.id, d]));
const res = JSON.parse(readFileSync(resultFile, 'utf8'));
const previous = new Map(prevFile && existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')).map((q) => [q.id, q.text]) : []);
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');

const final = [];
const stats = { total: res.items.length, model_disagrees: 0, genitive_used: 0, genitive_failed: 0, fallback_text: 0 };
for (const it of res.items) {
  const d = drafts.get(it.id);
  if (!d) continue;
  const disagrees = it.model_answer !== it.key;
  const modelSaid = it.options['ABCD'.indexOf(it.model_answer)] ?? it.model_answer;
  if (disagrees) stats.model_disagrees++;
  if (it.genitive_ok === true) stats.genitive_used++;
  if (it.genitive_ok === false) stats.genitive_failed++;
  let text = it.text;
  if (!(text.endsWith('?') && text.length <= 150 && !norm(text).includes(norm(d.correct)))) {
    text = d.template;
    stats.fallback_text++;
  }
  const prev = previous.get(d.id);
  final.push({ id: d.id, type: d.type, category: d.category ?? 'geography', text, correct: d.correct, wrong: d.wrong,
    source: `https://www.wikidata.org/wiki/${d.subject_qid}`,
    ...(it.genitive_ok === false ? { genitive_failed: `${d.gen_of} → ${it.genitive}` } : {}),
    ...(disagrees ? { model_disagrees: modelSaid } : {}),
    ...(prev && prev !== text ? { previous_text: prev } : {}) });
}
writeFileSync(out, JSON.stringify(final, null, 1));
console.log({ ...stats, model: res.model, mode: res.mode, seconds: res.seconds });
console.log('\nmodel disagrees (kept anyway):');
for (const q of final.filter((f) => f.model_disagrees)) console.log(` - ${q.text}  [Wikidata: ${q.correct}; модель: ${q.model_disagrees}]`);
console.log('\ngenitive failed (fallback wording):');
for (const q of final.filter((f) => f.genitive_failed)) console.log(` - ${q.genitive_failed}  -> "${q.text}"`);
console.log(`\n-> ${out}`);
