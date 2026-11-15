// The host's speech of one stream for the archive's clip form (mao-dao: php artisan guessword:speech-import).
// Whisper's word timestamps (work/<id>/transcript/transcript.json, recording seconds) become the LIVE log's seconds,
// and the game's announcer (a synthetic voice: "Привет, Ник. Добро пожаловать", the winner, the round start) is cut out:
// the log says when the announcer speaks, the words inside those windows must also sound like it.
// Usage: node speech-export.js <stream-id> <engine live.jsonl> <live_key> <out.json> --rounds <rounds.json>
//   <rounds.json>: work/rounds/live-*-full.json ({round, recording_s}); the shift recording -> LIVE log is the median of
//   recording_s - (the round's round_start second in the log) over the rounds of that LIVE.
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i < 0 ? null : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')));
const [id, logPath, liveKey, outPath] = pos;
if (!id || !logPath || !liveKey || !outPath || !opt('rounds')) { console.error('usage: see the header of this file'); process.exit(1); }
const ROOT = process.env.TIKTOK_CLIPS || path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

const log = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const starts = new Map(log.filter((e) => e.type === 'round_start').map((e) => [e.round, e.s]));
const shifts = read(opt('rounds')).filter((r) => r.recording_s != null && starts.has(r.round)).map((r) => r.recording_s - starts.get(r.round)).sort((a, b) => a - b);
if (!shifts.length) throw new Error('no round to align the recording with the log');
const shift = shifts[Math.floor(shifts.length / 2)];
console.log(`shift recording -> LIVE log: ${shift.toFixed(1)} s (from ${shifts.length} rounds, spread ${(shifts[shifts.length - 1] - shifts[0]).toFixed(1)} s)`);

// windows of the announcer's voice in recording seconds
const span = { round_start: 6, winner: 6, viewer: 5 };
const windows = log.filter((e) => span[e.type] && (e.type !== 'viewer' || e.first)).map((e) => [e.s + shift - 0.5, e.s + shift + span[e.type]]);
const ANNOUNCER = /добро пожаловать|привет|поехали|угадывает|победител|лидер|спасибо|ты в игре|подпиш/i;

const tr = read(path.join(ROOT, 'work', id, 'transcript', 'transcript.json'));
const all = tr.segments.flatMap((s) => s.words || []).map((w) => ({ w: w.w.trim(), s: w.s, e: w.e })).filter((w) => w.w);
const dropped = new Set();
for (const [a, b] of windows) {
  const inside = all.filter((w) => w.s < b && w.e > a);
  if (inside.length && ANNOUNCER.test(inside.map((w) => w.w).join(' '))) inside.forEach((w) => dropped.add(w));
}
const words = all.filter((w) => !dropped.has(w)).map((w) => [+(w.s - shift).toFixed(2), +(w.e - shift).toFixed(2), w.w]);
console.log(`${words.length} host words kept, ${dropped.size} announcer words dropped`);
fs.writeFileSync(outPath, JSON.stringify([{ live_key: liveKey, recording: id, words }]));
console.log('written', outPath, (fs.statSync(outPath).size / 1048576).toFixed(2), 'MB');
