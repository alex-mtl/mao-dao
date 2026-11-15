// Sentence-aware subtitle chunking shared by render-clips.js and chunk-preview.js.
// A chunk never crosses a sentence end; clauses (commas) of one sentence are merged while they fit MAX chars;
// long clauses are split evenly and a chunk never ends on a weak word (и, а, что, в...).
// For display: the chunk's final . , ; : … is dropped, and chunks longer than LINE chars wrap into two lines.
'use strict';
const MAX = 22;   // max chars on screen at once
const LINE = 17;  // max chars per line before wrapping into two lines (~880 px of Arial Black 72)
const WEAK = new Set(['и', 'а', 'но', 'в', 'во', 'на', 'с', 'со', 'к', 'у', 'о', 'об', 'по', 'за', 'из', 'от', 'до', 'не', 'ни',
  'что', 'как', 'то', 'же', 'ли', 'бы', 'the', 'a', 'an', 'to', 'of', 'and']);
const txt = c => c.map(w => w.w).join(' ');
const bare = w => w.w.toLowerCase().replace(/[.,!?…;:]/g, '');

// Whisper splits "опа-на" into "опа" + "-на": glue such tokens back.
function glue(list) {
  const out = [];
  for (const w of list) {
    const t = w.w.trim();
    if (/^-/.test(t) && !out.length) continue;   // tail of a word cut by the clip start
    if (/^-/.test(t) && out.length) { const p = out[out.length - 1]; out[out.length - 1] = { ...p, w: p.w + t, e: w.e }; }
    else if (t) out.push({ ...w, w: t });
  }
  return out;
}
// Best split point of a word list into two parts (balanced length, no weak word at the end of part one).
function bestSplit(c, startPenalty = true) {
  let best = null;
  for (let i = 1; i < c.length; i++) {
    const a = c.slice(0, i), b = c.slice(i);
    const cost = Math.max(txt(a).length, txt(b).length)
      + (WEAK.has(bare(a[a.length - 1])) ? 15 : 0)
      + (b.length === 1 && b[0].w.length <= 4 ? 10 : 0)
      + (b.length === 1 ? 3 : 0)
      + (startPenalty && b.length > 1 && bare(b[0]) === 'что' && a.length > 1 && bare(a[a.length - 1]) === 'только' ? 8 : 0);
    if (!best || cost < best.cost) best = { cost, i };
  }
  return best.i;
}
function splitEven(c) {
  if (txt(c).length <= MAX || c.length === 1) return [c];
  const i = bestSplit(c);
  return [...splitEven(c.slice(0, i)), ...splitEven(c.slice(i))];
}
function chunkWords(list) {
  const ws = glue(list);
  const sentences = []; let s = [];
  ws.forEach((w, i) => {
    s.push(w);
    const pause = ws[i + 1] ? ws[i + 1].s - w.e : 9;
    if (/[.!?…]$/.test(w.w) || pause > 0.7) { sentences.push(s); s = []; }
  });
  if (s.length) sentences.push(s);
  const out = [];
  for (const sen of sentences) {
    const clauses = []; let c = [];
    for (const w of sen) { c.push(w); if (/[,;:—–]$/.test(w.w)) { clauses.push(c); c = []; } }
    if (c.length) clauses.push(c);
    const merged = [];
    for (const cl of clauses) {
      const prev = merged[merged.length - 1];
      if (prev && txt(prev).length + 1 + txt(cl).length <= MAX) merged[merged.length - 1] = [...prev, ...cl];
      else merged.push(cl);
    }
    for (const m of merged) out.push(...splitEven(m));
  }
  return out;
}
// Display form: words with the final punctuation removed, grouped into 1 or 2 lines.
function displayLines(chunk) {
  const words = chunk.map((w, i) => (i === chunk.length - 1 ? w.w.replace(/[.,;:…]+$/, '') : w.w));
  const len = words.join(' ').length;
  if (len <= LINE || words.length === 1) return [words];
  const i = bestSplit(words.map(w => ({ w })), false);
  const first = words.slice(0, i); first[first.length - 1] = first[first.length - 1].replace(/[,;:]+$/, '');
  return [first, words.slice(i)];
}
module.exports = { chunkWords, displayLines, glue, MAX, LINE };
