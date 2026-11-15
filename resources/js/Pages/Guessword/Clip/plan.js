// "Hard round" clip, part 1 of 4: what goes into the clip. Pure functions, no DOM (tested by tests/clip/plan.test.mjs).
// Times are the LIVE log's seconds (t0 = the round's start, t1 = its end = the win); words = [[start, end, word], ...]
// of the host only (the game's announcer is cut out when the speech is imported).
// The structure of such a round: a time-lapse from the start to where the top of the table stops moving, a few
// remarks of the host at 1x with short jumps between them, the last seconds before the win, a freeze on the word,
// the host's reaction. No AI: the facts come from the log, the table's pixels and the transcript's timing.

export const FPS = 30;
export const FF_MAIN = 240;        // frames of the first time-lapse (8 s)
export const FF_JUMP = 36;         // frames of a jump between remarks (1.2 s)
export const FREEZE = 1.2;         // s
export const APPROACH = 4;         // s of 1x before the win
export const TAIL = 3.5;           // s of 1x after the win before the host's reaction
export const MIN_PHRASE = 2.5, MAX_PHRASE = 11, MIN_WORDS = 6;

const END = /[.!?]$/, COMMA = /,$/;

/** phrases the host said: cut at pauses and at the ends of sentences (or commas when it runs long) */
export function utterances(words, from, to) {
    const ws = words.filter((w) => w[0] >= from && w[1] <= to), out = [];
    let cur = [];
    const flush = () => {
        if (cur.length >= MIN_WORDS) {
            const a = cur[0][0], b = cur[cur.length - 1][1];
            if (b - a >= MIN_PHRASE) {
                out.push({
                    from: Math.round((a - 0.1) * 10) / 10, to: Math.round((b + 0.2) * 10) / 10,
                    text: cur.map((w) => w[2]).join(' ').replace(/ ([,.!?])/g, '$1'),
                    words: cur.length, score: Math.round((cur.length / (b - a)) * 100) / 100,
                });
            }
        }
        cur = [];
    };
    for (const w of ws) {
        const prev = cur[cur.length - 1], gap = prev ? w[0] - prev[1] : 0, len = prev ? prev[1] - cur[0][0] : 0;
        if (prev && (gap >= 0.7 || (END.test(prev[2]) && len >= MIN_PHRASE) || (len >= 7 && (COMMA.test(prev[2]) || gap >= 0.25)) || len >= MAX_PHRASE)) flush();
        cur.push(w);
    }
    flush();
    return out;
}

/** the zone of a phrase, for the list: before the finale, the finale (last seconds before the win), after the round */
export const zoneOf = (from, t1) => (from < t1 - APPROACH ? 'before' : from < t1 + TAIL ? 'finale' : 'after');

/** candidate phrases for the form: the densest 30 inside the round, the densest 30 of the 150 s after it, by time */
export function candidates(words, t0, t1, afterS = 150) {
    const all = utterances(words, t0 + 30, t1 + afterS);
    const top = (list, n) => [...list].sort((a, b) => b.score - a.score).slice(0, n);
    return [...top(all.filter((u) => u.from < t1), 30), ...top(all.filter((u) => u.from >= t1), 30)]
        .sort((a, b) => a.from - b.from)
        .map((u, i) => ({ id: i + 1, zone: zoneOf(u.from, t1), ...u }));
}

/** the remarks ticked by default: up to three dense ones in the second half of the round, one reaction after the win */
export function defaultPicks(cands, t0, t1) {
    const mid = t0 + (t1 - t0) * 0.55, got = [];
    for (const c of [...cands].filter((x) => x.from >= mid + 8 && x.from <= t1 - 35).sort((a, b) => b.score - a.score)) {
        if (got.every((g) => Math.abs(g.from - c.from) > 25)) got.push(c);
        if (got.length === 3) break;
    }
    const after = [...cands].filter((x) => x.from >= t1 + TAIL - 0.5 && x.from <= t1 + 60).sort((a, b) => b.score - a.score)[0];
    return [...got, ...(after ? [after] : [])].map((c) => c.id);
}

/**
 * Where the top of the table stops changing: diffs[i] = how much the picture of the top rows changed between
 * sample i and i + 1 (0..255), taken every `step` s from t0. The longest quiet run (diff < 2) that starts after the
 * first fifth of the round and ends before its last 40 s; its start is returned (null: none, the caller picks a default).
 */
export function stallFrom(diffs, step, t0, duration) {
    let best = { len: 0, at: -1 }, run = 0;
    for (let i = 0; i < diffs.length; i++) {
        run = diffs[i] < 2 ? run + 1 : 0;
        const start = i - run + 1;
        if (run > best.len && start * step > duration * 0.2 && (i + 1) * step < duration - 40) best = { len: run, at: start };
    }
    return best.at < 0 ? null : t0 + best.at * step;
}

/**
 * The timeline. picks = chosen phrases {from, to} (any order). Returns {segs, total}: segs = [{kind: 'ff' | 'dense' | 'freeze',
 * from, to (LIVE s), frames (ff), at (freeze), out0, dur (clip s)}].
 */
export function plan({ t0, t1, stall, picks }) {
    const sorted = [...picks].sort((a, b) => a.from - b.from);
    const before = sorted.filter((p) => p.from < t1 - APPROACH), after = sorted.filter((p) => p.from >= t1 - APPROACH);
    const segs = [];
    const ffEnd = Math.max(t0 + 30, Math.min(stall - 2, (before[0]?.from ?? Infinity) - 3, t1 - APPROACH - 10));
    segs.push({ kind: 'ff', from: t0, to: ffEnd, frames: FF_MAIN });
    let at = ffEnd;
    for (const p of before) {
        if (p.from - at > 8) segs.push({ kind: 'ff', from: at, to: p.from, frames: FF_JUMP });
        segs.push({ kind: 'dense', from: Math.max(p.from, at), to: p.to });
        at = p.to;
    }
    if (t1 - APPROACH - at > 8) segs.push({ kind: 'ff', from: at, to: t1 - APPROACH, frames: FF_JUMP });
    segs.push({ kind: 'dense', from: t1 - APPROACH, to: t1, zoom: true });
    segs.push({ kind: 'freeze', from: t1, to: t1, at: t1, dur: FREEZE });
    segs.push({ kind: 'dense', from: t1, to: t1 + TAIL, zoom: true });
    let end = t1 + TAIL;
    for (const p of after) {
        if (p.to <= end) continue;
        segs.push({ kind: 'dense', from: Math.max(p.from, end), to: p.to });
        end = p.to;
    }
    let out = 0;
    for (const s of segs) {
        s.out0 = out;
        s.dur = s.kind === 'ff' ? s.frames / FPS : s.kind === 'freeze' ? s.dur : s.to - s.from;
        out += s.dur;
    }
    return { segs, total: out };
}

const clean = (s) => s.replace(/[.,]+$/, '').trim();

/** subtitle chunks of the words inside [from, to]: up to 22 characters on the screen, cut at sentence ends and pauses */
export function subtitleChunks(words, from, to) {
    const ws = words.filter((w) => w[0] >= from - 0.05 && w[1] <= to + 0.05), chunks = [];
    let cur = [], len = 0;
    const flush = () => { if (cur.length) chunks.push(cur); cur = []; len = 0; };
    for (const w of ws) {
        const t = clean(w[2]), prev = cur[cur.length - 1];
        if (prev && (w[0] - prev[1] > 0.5 || len + 1 + t.length > 22 || END.test(prev[2]) || (COMMA.test(prev[2]) && len > 12))) flush();
        cur.push(w);
        len += (len ? 1 : 0) + t.length;
    }
    flush();
    return chunks.map((c) => {
        const ws2 = c.map((w) => ({ t: clean(w[2]).toUpperCase(), s: w[0], e: w[1] }));
        const text = ws2.map((w) => w.t).join(' ');
        let split = ws2.length;                                   // one line up to 17 characters, else two balanced lines
        if (text.length > 17 && ws2.length > 1) {
            let best = Infinity;
            for (let i = 1; i < ws2.length; i++) {
                const worst = Math.max(ws2.slice(0, i).map((w) => w.t).join(' ').length, ws2.slice(i).map((w) => w.t).join(' ').length);
                if (worst < best) { best = worst; split = i; }
            }
        }
        return { words: ws2, split, from: c[0][0], to: c[c.length - 1][1] };
    });
}
