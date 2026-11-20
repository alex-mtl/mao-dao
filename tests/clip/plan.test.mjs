// node tests/clip/plan.test.mjs : the pure parts of the hard-round clip (resources/js/Pages/Guessword/Clip/plan.js)
import assert from 'node:assert/strict';
import { candidates, defaultPicks, FPS, plan, stallFrom, stripAnnouncer, subtitleChunks, utterances } from '../../resources/js/Pages/Guessword/Clip/plan.js';

const say = (start, text, per = 0.4) => text.split(' ').map((w, i) => [start + i * per, start + i * per + per - 0.05, w]);

// phrases: cut at a pause, sentences end phrases, short ones are kept (the list shows every phrase)
const words = [...say(100, 'это очень длинная фраза про игру и слова.'), ...say(110, 'коротко'), ...say(120, 'а теперь вторая фраза без точки в конце совсем')];
const u = utterances(words, 0, 1000);
assert.equal(u.length, 3);
assert.equal(u[1].text, 'коротко');
assert.match(u[0].text, /^это очень длинная фраза про игру и слова\.$/);
assert.ok(u[0].score > 2 && u[0].to > u[0].from + 2.5);

// a fragment cut by a pause (not a sentence end) joins the next one if they are close: the round 51 case
const frag = [[100, 100.4, 'тяжко'], [100.5, 100.9, 'где'], [104, 104.3, '-то'], ...say(104.4, 'при том что агрегат отгадали давным-давно и', 0.3)];
const fj = utterances(frag, 0, 1000);
assert.equal(fj.length, 1);
assert.match(fj[0].text, /^тяжко где -то при том/);
assert.ok(fj[0].to - fj[0].from <= 11.4);
// ...but not across a sentence end, and not when they are far apart
assert.equal(utterances([...say(100, 'это одна законченная фраза про игру.', 0.45), ...say(103.5, 'а это другая фраза совсем про другое', 0.45)], 0, 1000).length, 2);
assert.equal(utterances([...say(100, 'раз два три четыре пять шесть семь', 0.45), ...say(112, 'ещё одна фраза тут идёт дальше теперь', 0.45)], 0, 1000).length, 2);

// candidates carry zones; the default picks keep 25 s between them
const t0 = 0, t1 = 900, all = [];
for (let s = 520; s < 860; s += 30) all.push(...say(s, 'раз два три четыре пять шесть семь восемь.'));
all.push(...say(t1 + 20, 'очень здорово что вы все здесь собрались сегодня.'));
const c = candidates(all, t0, t1);
assert.ok(c.some((x) => x.zone === 'before') && c.some((x) => x.zone === 'after'));
const picks = defaultPicks(c, t0, t1);
const chosen = c.filter((x) => picks.includes(x.id));
assert.ok(chosen.filter((x) => x.zone === 'before').length <= 3 && chosen.some((x) => x.zone === 'after'));
const before = chosen.filter((x) => x.zone === 'before').map((x) => x.from).sort((a, b) => a - b);
before.slice(1).forEach((f, i) => assert.ok(f - before[i] > 25));

// the stall: the longest quiet run in the middle, not the one at the very end
const d = Array(180).fill(70);
for (let i = 50; i < 62; i++) d[i] = 0.3;
for (let i = 165; i < 175; i++) d[i] = 0.3;       // inside the last 40 s: ignored
assert.equal(stallFrom(d, 5, 1000, 900), 1250);
assert.equal(stallFrom(Array(10).fill(70), 5, 0, 900), null);

// the timeline: chronological, frames and times add up, the freeze sits on the win
const pl = plan({ t0, t1, stall: 600, picks: chosen });
assert.equal(pl.segs.filter((s) => s.kind === 'freeze')[0].at, t1);
let end = 0;
for (const s of pl.segs) { assert.ok(Math.abs(s.out0 - end) < 1e-9); end = s.out0 + s.dur; }
assert.ok(Math.abs(end - pl.total) < 1e-9);
assert.equal(pl.segs[0].kind, 'ff');
assert.equal(pl.segs[0].frames / FPS, 8);
const dense = pl.segs.filter((s) => s.kind === 'dense');
dense.slice(1).forEach((s, i) => assert.ok(s.from >= dense[i].from));
// a pick early in the round pulls the first time-lapse's end before it
const early = plan({ t0, t1, stall: 600, picks: [{ from: 200, to: 207 }] });
assert.ok(early.segs[0].to <= 197);

// subtitles: at most 22 characters per chunk, two balanced lines above 17
const ch = subtitleChunks(say(10, 'это одна длинная фраза которую надо разбить на экраны'), 0, 100);
assert.ok(ch.length >= 2);
ch.forEach((k) => assert.ok(k.words.map((w) => w.t).join(' ').length <= 22));
const two = subtitleChunks(say(10, 'длинное слово подряд идёт'), 0, 100)[0];
assert.ok(two.split > 0 && two.split <= two.words.length);

console.log('clip plan: ok');

// the announcer's lines are cut, the host's words stay
const ann = [...say(100, 'Огромный скачок у Родион Увы, Родион Чтобы победить, нужно подписаться.', 0.3), ...say(110, 'Молодец апельсин дожала дожала!'), ...say(120, 'огромный скачок у скиллтер почти таша в одном шаге от победы', 0.3), ...say(130, 'Это вот про настойчивость')];
assert.deepEqual(stripAnnouncer(ann).map((w) => w[2]).join(' '), 'Молодец апельсин дожала дожала! Это вот про настойчивость');
console.log('announcer: ok');
