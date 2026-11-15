// "Hard round" clip + cover from the round's structure (no AI): a time-lapse from the round start to the point
// where the top of the table stops changing, three host remarks at 1x with short jumps between them, the last
// seconds before the win with a freeze on the word, the host's reaction, and a 3:4 cover cut from a real frame.
// Usage: node hard-round.js <stream-id> <round> <out-dir> --rounds <rounds.json> [--log <engine live.jsonl>] [--winner "Nick"] [--stall mm:ss]
//   <rounds.json>: array of { round, word, recording_s, duration_s } (work/rounds/live-*-full.json)
//   --stall overrides the detected "table stopped changing" time (stream-relative, in the recording).
// It writes <out-dir>/spec.json + words.json, runs render-clips.js and makes <out-dir>/cover.png.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FFDIR = path.join(os.homedir(), 'Downloads/ffmpeg-2024-11-06-git-4047b887fc-full_build/bin');
const FF = path.join(FFDIR, 'ffmpeg.exe'), FFP = path.join(FFDIR, 'ffprobe.exe');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = process.env.TIKTOK_CLIPS || path.join(__dirname, '..');   // the folder with input/ and work/ (when this file is a copy elsewhere)

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i < 0 ? null : args[i + 1]; };
const [id, roundNo, outDirArg] = args.filter((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')));
if (!id || !roundNo || !outDirArg || !opt('rounds')) { console.error('usage: see the header of this file'); process.exit(1); }
const outDir = path.resolve(outDirArg);
const sec = t => typeof t === 'number' ? t : String(t).split(':').reduce((a, x) => a * 60 + Number(x), 0);
const mmss = t => `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(Math.floor(t) % 60).padStart(2, '0')}`;
const src = path.join(ROOT, 'input', id + '.mp4');
fs.mkdirSync(outDir, { recursive: true });

const rd = JSON.parse(fs.readFileSync(opt('rounds'), 'utf8').replace(/^\uFEFF/, '')).find(r => String(r.round) === roundNo);
if (!rd) throw new Error('round not found in ' + opt('rounds'));
// the engine log (live.jsonl) gives the exact end of the round and its winner; without it the rounded duration is used
let winnerName = opt('winner'), durS = rd.duration_s, gameVoice = [];
if (opt('log')) {
  const all = fs.readFileSync(opt('log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const ev = all.filter(e => String(e.round) === roundNo);
  const st = ev.find(e => e.type === 'round_start'), en = ev.find(e => e.type === 'round_end');
  if (st && en) durS = en.s - st.s;
  if (en && en.winner && !winnerName) winnerName = en.winner.name;
  // The game's own voice (synthetic announcer) speaks at logged moments: a new viewer ("Привет, Ник. Добро пожаловать"),
  // round start, winner. Planes, balloons and cakes are silent. A logged moment only marks a window; the words inside are
  // dropped when they also sound like the announcer (the host may be talking over the same seconds).
  if (st) {
    const off = rd.recording_s - st.s, span = { round_start: 6, winner: 6, viewer: 5 };
    gameVoice = all.filter(e => span[e.type] && (e.type !== 'viewer' || e.first)).map(e => [e.s + off - 0.5, e.s + off + span[e.type]]);
  }
}
const T0 = rd.recording_s, T1 = rd.recording_s + durS, minutes = Math.round(durS / 60);

// ---- video size (crop geometry is given for 720x1280 and scaled by the height) ----
const probe = spawnSync(FFP, ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src], { encoding: 'utf8' }).stdout.trim().split(',').map(Number);
const [VW, VH] = probe, k = VH / 1280;

// ---- 1. where the top of the table stops changing ----
function detectStall() {
  const STEP = 5, W = 64, H = 32;
  const r = spawnSync(FF, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(T0), '-t', String(T1 - T0), '-i', src,
    '-vf', `fps=1/${STEP},crop=${Math.round(548 * k)}:${Math.round(190 * k)}:${Math.round(92 * k)}:${Math.round(432 * k)},scale=${W}:${H},format=gray`,
    '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const buf = r.stdout, n = Math.floor(buf.length / (W * H));
  // the top of the table changes in jumps (diff ~70) and sits still in between (diff < 2): take the longest quiet
  // run that starts after the first fifth of the round and ends before its last 40 s
  let best = { len: 0, at: Math.floor(n / 4) }, run = 0;
  for (let i = 1; i < n; i++) {
    let d = 0;
    for (let j = 0; j < W * H; j++) d += Math.abs(buf[i * W * H + j] - buf[(i - 1) * W * H + j]);
    run = d / (W * H) < 2 ? run + 1 : 0;
    const start = i - run + 1;
    if (run > best.len && start * STEP > durS * 0.2 && i * STEP < durS - 40) best = { len: run, at: start };
  }
  console.log(`longest quiet run: ${best.len * STEP} s`);
  return T0 + best.at * STEP;
}
const stall = opt('stall') ? sec(opt('stall')) : detectStall();
console.log(`round ${roundNo} «${rd.word}» ${minutes} min, recording ${mmss(T0)}–${mmss(T1)}, table stalls from ${mmss(stall)}`);

// ---- 2. the host's remarks: densest speech windows (words per second), no AI ----
const tr = JSON.parse(fs.readFileSync(path.join(ROOT, 'work', id, 'transcript', 'transcript.json'), 'utf8'));
const allWords = tr.segments.flatMap(s => s.words || []).map(w => ({ w: w.w.trim(), s: w.s, e: w.e }));
const ANNOUNCER = /добро пожаловать|привет|поехали|угадывает|победител|лидер|спасибо|ты в игре|подпиш/i;
const dropped = new Set();
for (const [a, b] of gameVoice) {
  const inside = allWords.filter(w => w.s < b && w.e > a);
  if (inside.length && ANNOUNCER.test(inside.map(w => w.w).join(' '))) inside.forEach(w => dropped.add(w));
}
const words = allWords.filter(w => !dropped.has(w));   // host only: subtitles and remarks
console.log(`announcer words dropped: ${dropped.size} of ${allWords.length}`);
fs.writeFileSync(path.join(outDir, 'words.json'), JSON.stringify({ [id]: { words } }));
function windows(from, to, len) {
  const ws = words.filter(w => w.s >= from && w.e <= to), out = [];
  for (let i = 0; i < ws.length; i++) {
    if (i && ws[i].s - ws[i - 1].e < 0.4) continue;                      // start after a pause
    let j = i;
    while (j + 1 < ws.length && (ws[j].e - ws[i].s < len || ws[j + 1].s - ws[j].e < 0.3) && ws[j + 1].e - ws[i].s < len + 2.5) j++;
    const dur = ws[j].e - ws[i].s;
    if (dur >= len * 0.8 && !/добро пожаловать|поехали|угадывает/i.test(ws.slice(i, j + 1).map(w => w.w).join(' '))) out.push({ from: ws[i].s - 0.1, to: ws[j].e + 0.2, score: (j - i + 1) / dur });
  }
  return out.sort((a, b) => b.score - a.score);
}
function pick(from, to, len, count, gap) {
  const got = [];
  for (const c of windows(from, to, len)) {
    if (got.every(g => Math.abs(g.from - c.from) > gap)) got.push(c);
    if (got.length === count) break;
  }
  return got.sort((a, b) => a.from - b.from);
}
// Candidate phrases for the host-remark checklist: utterances (words with pauses < 0.7 s between them), 2.5-9 s, 6+ words,
// the announcer already removed. The streamer ticks the ones to keep (--pick); without --pick the densest are taken.
function utterances(from, to) {
  const ws = words.filter(w => w.s >= from && w.e <= to), out = [];
  let cur = [];
  const flush = () => {
    if (cur.length >= 6 && cur[cur.length - 1].e - cur[0].s >= 2.5) {
      const dur = cur[cur.length - 1].e - cur[0].s;
      out.push({ from: cur[0].s - 0.1, to: cur[cur.length - 1].e + 0.2, text: cur.map(w => w.w).join(' ').replace(/ ([,.!?])/g, '$1'), words: cur.length, score: +(cur.length / dur).toFixed(2) });
    }
    cur = [];
  };
  for (const w of ws) {
    const gap = cur.length ? w.s - cur[cur.length - 1].e : 0;
    // a phrase ends at a pause, at a sentence end once it is long enough, or at a comma / small pause when it gets too long
    const prev = cur.length ? cur[cur.length - 1] : null, len = prev ? prev.e - cur[0].s : 0;
    if (prev && (gap >= 0.7 || (/[.!?]$/.test(prev.w) && len >= 2.5) || (len >= 7 && (/,$/.test(prev.w) || gap >= 0.25)) || len >= 11)) flush();
    cur.push(w);
  }
  flush();
  return out.filter(u => !ANNOUNCER.test(u.text));
}
const AFTER = Number(opt('after') || 150);   // seconds after the round end that are searched for remarks
const top = (list, n) => list.sort((a, b) => b.score - a.score).slice(0, n);
const allU = utterances(T0 + 30, T1 + AFTER).map(u => ({ ...u, zone: u.from < stall ? 'до застревания' : u.from < T1 - 4 ? 'застревание' : u.from < T1 + 3.5 ? 'развязка' : 'после' }));
// the 60 s after the round often hold the best remarks: they get their own quota so the densest talk of the round cannot crowd them out
const cands = [...top(allU.filter(u => u.from < T1), 30), ...top(allU.filter(u => u.from >= T1), 30)].sort((a, b) => a.from - b.from).map((u, i) => ({ id: i + 1, at: mmss(u.from), ...u, from: +u.from.toFixed(1), to: +u.to.toFixed(1) }));
fs.writeFileSync(path.join(outDir, 'phrases.json'), JSON.stringify(cands, null, 1));
fs.writeFileSync(path.join(outDir, 'phrases.md'), cands.map(c => `[${c.id}] ${c.at} (${(c.to - c.from).toFixed(1)} с, ${c.zone}) ${c.text}`).join('\n') + '\n');
console.log(`${cands.length} candidate phrases -> ${path.join(outDir, 'phrases.md')}`);
if (args.includes('--list')) process.exit(0);
let quotes, afterList;
if (opt('pick')) {
  const ids = opt('pick').split(',').map(Number), chosen = cands.filter(c => ids.includes(c.id));
  quotes = chosen.filter(c => c.from < T1 - 4);
  afterList = chosen.filter(c => c.from >= T1 - 4);
} else {
  quotes = pick(stall + 8, T1 - 35, 5, 3, 25);
  afterList = [pick(T1 + 3, T1 + 45, 7.5, 1, 0)[0] || { from: T1 + 3.5, to: T1 + 11 }];
}

// ---- 3. the timeline ----
const parts = [{ kind: 'ff', from: T0, to: Math.max(T0 + 60, stall - 2), frames: 240 }];
quotes.forEach((q, i) => {
  if (i) parts.push({ kind: 'ff', from: quotes[i - 1].to, to: q.from, frames: 36 });
  parts.push({ kind: 'main', from: q.from, to: q.to });
});
const lastTo = quotes.length ? quotes[quotes.length - 1].to : stall;
if (T1 - 4 - lastTo > 8) parts.push({ kind: 'ff', from: lastTo, to: T1 - 4, frames: 36 });
parts.push({ kind: 'main', from: T1 - 4, to: T1 + 3.5 });
afterList.forEach(a => parts.push({ kind: 'main', from: Math.max(a.from, T1 + 3.5), to: a.to }));
// The freeze caption is drawn by Chrome (emoji and Unicode "font" letters of the nickname stay as written), then laid over the frame.
const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const platePath = path.join(outDir, 'plate.html');
fs.writeFileSync(platePath, `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:transparent}
body{width:1080px;height:1920px;position:relative;font-family:'Arial Black',Arial,sans-serif;color:#fff}
.b{position:absolute;left:0;right:0;top:1000px;text-align:center}
.b div{display:inline-block;background:rgba(255,62,165,.92);padding:26px 40px;border-radius:6px;max-width:980px;box-sizing:border-box}
.w{font-size:84px;line-height:1.1;margin-bottom:${winnerName ? 14 : 0}px}.n{font-size:50px;line-height:1.2;font-family:'Arial Black','Segoe UI Emoji','Segoe UI Symbol','Noto Color Emoji',sans-serif;word-break:break-word}</style>
<div class=b><div><div class=w>${esc(rd.word.toUpperCase())}</div>${winnerName ? `<div class=n>УГАДАЛ(А): ${esc(winnerName)}</div>` : ''}</div></div>`);
spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', '--window-size=1080,1920',
  `--screenshot=${path.resolve(outDir, 'plate.png')}`, 'file:///' + path.resolve(platePath).replace(/\\/g, '/')], { stdio: 'ignore' });
const spec = { source: src, clips: [{
  id: `hard${roundNo}`, type: 'A', hook: `${minutes} минут на одно слово`, parts,
  fx: { freeze: { at: T1, dur: 1.2, text: rd.word, image: path.resolve(outDir, 'plate.png') }, zooms: [{ at: T1 - 3, dur: 5, z: 1.25 }], sfx: [{ type: 'tada', at: T1 }] },
}] };
fs.writeFileSync(path.join(outDir, 'spec.json'), JSON.stringify(spec, null, 1));
const total = parts.reduce((a, p) => a + (p.kind === 'ff' ? p.frames / 30 : p.to - p.from), 0) + 1.2;
console.log(`~${total.toFixed(1)} s; remarks:`, quotes.map(q => mmss(q.from)).join(' '), '; after:', afterList.map(a => mmss(a.from)).join(' '));

// ---- 4. render the clip (render-clips.js does the effects, subtitles, CTA) ----
const r = spawnSync('node', [path.join(__dirname, 'render-clips.js'), path.join(outDir, 'spec.json'), path.join(outDir, 'words.json'), outDir], { stdio: 'inherit' });
if (r.status) process.exit(r.status);

// ---- 5. cover: the table cut from a real frame shortly before the win ----
const frameAt = T1 - (opt('cover-before') ? Number(opt('cover-before')) : 30);
const fr = path.join(outDir, 'cover-frame.png');
spawnSync(FF, ['-nostdin', '-loglevel', 'error', '-y', '-ss', String(frameAt), '-i', src, '-frames:v', '1', fr]);
const rowH = 37.6 * k, cropH = Math.round(10 * rowH + 4 * k);
spawnSync(FF, ['-nostdin', '-loglevel', 'error', '-y', '-i', fr, '-vf',
  `crop=${Math.round(548 * k)}:${cropH}:${Math.round(92 * k)}:${Math.round(432 * k)},scale=1000:-1:flags=lanczos`, path.join(outDir, 'cover-table.png')]);
const date = (opt('date') || id.slice(0, 10)).split('-').reverse().join('.');
const html = `<!doctype html><meta charset=utf-8><style>
body{margin:0;width:1080px;height:1440px;background:#0a0019;font-family:'Arial Black',Arial,sans-serif;color:#f4f0ff;position:relative;overflow:hidden}
.a{position:absolute;left:0;right:0;text-align:center}
.fr{position:absolute;left:40px;top:470px;width:1000px;height:694px;border-radius:26px;border:3px solid #7a3cff;background:#05001a;overflow:hidden}
.fr img{position:absolute;left:0;top:0;width:1000px}</style>
<div class=a style="top:50px;font-size:34px;color:#00f0ff;letter-spacing:.12em">УГАДАЙ СЛОВО · ${date}</div>
<div class=a style="top:130px;font-size:64px;color:#FF3EA5">ЧАТ НЕ СПРАВИЛСЯ</div>
<div class=a style="top:245px;font-size:112px;line-height:1.1;color:#39ff14">А ТЫ УГАДАЛ?</div>
<div class=fr><img src="cover-table.png"></div>
<div class=a style="top:1215px;font-size:34px;color:#a99bd0">${minutes} МИНУТ · ТОП-10 ЗА СЕКУНДЫ ДО РАЗГАДКИ</div>
<div class=a style="top:1340px;font-size:34px;color:#00f0ff">@${(opt('user') || 'mao.montreal').toUpperCase()}</div>`;
const htmlPath = path.join(outDir, 'cover.html');
fs.writeFileSync(htmlPath, html);
spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1080,1440',
  `--screenshot=${path.resolve(outDir, 'cover.png')}`, 'file:///' + path.resolve(htmlPath).replace(/\\/g, '/')], { stdio: 'ignore' });
console.log('cover:', path.join(outDir, 'cover.png'));
