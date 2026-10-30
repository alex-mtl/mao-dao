// "Champion race" digest, part 1 of 3: the facts of one stream -> players, races, clip time, temperature.
// Pure functions, no DOM: used by the streamer's archive page (Pages/Guessword/Archive.jsx) and by the
// local clips pipeline (tiktok-clips/tools/digest-race.js opens Digest/runner.html in headless Chrome).
// One change here changes both. Drawing: draw.js, video: build.js.

// word-temperature colors of the game (stream-engine/app/web/common/neon.css), hottest first; the last one repeats
export const TEMPS = ['#ff2d55', '#ff6a00', '#ffb800', '#c6ff00', '#00e5ff', '#5b7cff'];
export const VIDEO = 60;      // clip seconds
export const FPS = 30;
export const BIN = 300;       // temperature bins: 5 stream minutes
// the cake show is played whole, CAKE_SPEED times faster than the stream (the rest of the clip is ~450x), with a
// CAKE_PAUSE stop when the cake has turned its top with the avatar to us, just before it flies apart; the clip
// gets longer by these stretches (60 s stays the rest). The show's moments come from the LIVE log
// (cake_start / cake_last / cake_split, since 30.10.2026); older logs: the engine's timing with a quiet chat.
export const CAKE_SPEED = 20, CAKE_PAUSE = 0.2;
const SHOW = { lit: 10, first: 1.8, crackers: 100, toSplit: 3.2 + 2.7, fly: 1.3 };   // stream-engine/app/reactions/cake.py

const clean = (s) => String(s || '').replace(/^[\s,]+|[\s,]+$/g, '');
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
}
// misheard spellings of one nick (nicks recognised from the game's voice): equal words or typos in long ones
const same = (x, y) => {
    const a = norm(x), b = norm(y);
    if (a.join(' ') === b.join(' ')) return true;
    if (a.length !== b.length || !a.length) return false;
    return a.every((t, i) => t === b[i] || (t.length >= 5 && lev(t, b[i]) <= 2));
};

/**
 * Facts from the old events.json of tiktok-clips: [{t, type: round|winner|plane|balloon|cake|timeout, who, word, exact, n}]
 * (t = stream second). exact = nick from a game log; otherwise recognised from the game's voice.
 */
export function factsFromEvents(events, { duration = 0, date = '' } = {}) {
    const by = (type) => events.filter((e) => e.type === type);
    return {
        date,
        duration: duration || Math.max(0, ...events.map((e) => e.t)),
        rounds: by('round').length,
        wins: by('winner').map((e) => ({ t: e.t, key: '', name: clean(e.who), avatar: '', word: clean(e.word), exact: !!e.exact })),
        planes: by('plane').filter((e) => e.who).map((e) => ({ t: e.t, key: clean(e.who), name: clean(e.who), avatar: '' })),
        balloons: by('balloon').map((e) => ({ t: e.t, n: e.n || 1, key: clean(e.who), name: clean(e.who), avatar: '' })),
        cakes: by('cake').map((e) => ({ t: e.t, key: clean(e.who), name: clean(e.who), avatar: '' })),
        fires: by('fire').map((e) => e.t),
    };
}

/**
 * Facts from a LIVE log of the engine: JSONL objects {s, type, user: {uid, id, name}, ...}
 * (docs/games/guessword.md, "Live logs"); a log filtered to these types by Laravel reads the same.
 */
export function factsFromLive(lines) {
    const start = lines.find((l) => l.type === 'live_start');
    const who = (u = {}) => ({ key: u.uid || (u.id ? '@' + u.id : clean(u.name)), name: clean(u.name || u.id || '?'), avatar: u.uid || u.id || '' });
    const of = (type) => lines.filter((l) => l.type === type && typeof l.s === 'number');
    const at = (type) => Object.fromEntries(of(type).filter((l) => l.seed).map((l) => [l.seed, l.s]));
    const shows = { start: at('cake_start'), last: at('cake_last'), split: at('cake_split') };
    return {
        date: start ? String(start.t).slice(0, 10) : '',
        duration: Math.max(0, ...lines.map((l) => l.s || 0)),
        rounds: of('round_start').length,
        wins: of('winner').map((l) => ({ t: l.s, ...who(l.user), word: clean(l.word), exact: true })),
        planes: of('plane').map((l) => ({ t: l.s, ...who(l.user) })),
        // a gift / manual launch of N balloons counts N; cakes: automatic (likes) or [manual]
        balloons: of('balloon').map((l) => ({ t: l.s, n: l.likes ? 1 : (l.count || 1), ...who(l.user) })),
        cakes: of('cake').map((l) => ({
            t: l.s, manual: !!l.manual, ...who(l.user),
            start: shows.start[l.seed], last: shows.last[l.seed], split: shows.split[l.seed],
        })),
        // "огонь" in the chat (logs rebuilt from the journal): the shows before 30.10 end by these
        fires: of('fire').map((l) => l.s),
    };
}

// When the last cracker took off, by the game's rules (reactions/cake.py, and the pages' own clock before
// 30.10): the fuses burn SHOW.lit s after the start, the first cracker goes SHOW.first s later, then one a
// second; every "огонь" fires one more at once, those said before the first take-off go then, .12 s apart.
function lastCracker(from, fires) {
    const first = from + SHOW.lit + SHOW.first;
    const launches = [];
    fires.filter((t) => t >= from && t < first).slice(0, SHOW.crackers).forEach((_, j) => launches.push(first + j * 0.12));
    fires.filter((t) => t >= first).forEach((t) => launches.push(t));
    for (let k = 0; k < SHOW.crackers; k++) launches.push(first + k);
    return launches.sort((a, b) => a - b)[SHOW.crackers - 1];
}

/**
 * The cake shows on the stream's clock: [{from, split, to}] (stream seconds), from the log when it has the
 * moments (since 30.10), else rebuilt by the game's rules from the chat's "огонь" (fires: stream seconds;
 * none known = a quiet chat, the longest show); one show at a time (the next one waits).
 */
export function cakeShows(cakes, stream, fires = []) {
    const out = [];
    let free = 0;
    for (const c of [...cakes].sort((a, b) => a.t - b.t)) {
        const from = c.start ?? Math.max(c.t, free);
        const split = c.split ?? (c.last ?? lastCracker(from, fires)) + SHOW.toSplit;
        const to = split + SHOW.fly + 0.3;
        if (from >= stream) continue;
        out.push({ from, split: Math.min(split, stream), to: Math.min(to, stream) });
        free = to;
    }
    return out;
}

/**
 * Stream time <-> clip time, piece by piece: the stream at `scale` clip s per stream s, the cake shows at
 * 1 / CAKE_SPEED, stops (a cake's CAKE_PAUSE, a win's `slow`) as pieces of clip time at one stream moment.
 * Returns {total (clip s), clipOf(t), at(v) -> {t, piece}}.
 */
function timeline(stream, scale, slowSpans, stops) {
    const cuts = [...new Set([0, stream, ...slowSpans.flatMap((s) => [s.from, s.to]), ...stops.map((s) => s.t)])]
        .filter((t) => t >= 0 && t <= stream).sort((a, b) => a - b);
    const pieces = [];
    let c = 0;
    for (let i = 0; i < cuts.length; i++) {
        for (const s of stops.filter((x) => x.t === cuts[i])) { pieces.push({ t0: cuts[i], t1: cuts[i], c0: c, dur: s.dur, kind: s.kind }); c += s.dur; }
        if (i === cuts.length - 1) break;
        const t0 = cuts[i], t1 = cuts[i + 1], slow = slowSpans.some((s) => s.from <= t0 && t1 <= s.to);
        const rate = slow ? 1 / CAKE_SPEED : scale;
        pieces.push({ t0, t1, c0: c, rate, dur: (t1 - t0) * rate, kind: slow ? 'cake' : '' });
        c += (t1 - t0) * rate;
    }
    const total = c;
    function clipOf(t) {
        let lo = 0, hi = pieces.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pieces[m].t0 < t || (pieces[m].t0 === t && pieces[m].rate)) lo = m; else hi = m - 1; }
        const p = pieces[lo];
        return p.rate ? p.c0 + (Math.min(t, p.t1) - p.t0) * p.rate : p.c0;
    }
    function at(v) {
        let lo = 0, hi = pieces.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pieces[m].c0 <= v) lo = m; else hi = m - 1; }
        const p = pieces[lo];
        if (!p.rate) return { t: p.t0, piece: p };
        return { t: Math.min(stream, p.t0 + (v - p.c0) / p.rate), piece: p };
    }
    return { total, clipOf, at, pieces };
}

/**
 * Players: one per TikTok user id (live logs) or per nick with its misheard spellings merged (old events);
 * the shown name is the most frequent spelling. Repeated announcements of one win (< 60 s, same word) drop.
 */
function players(facts) {
    const people = {};    // key -> {name, avatar, variants}
    const add = (key, name, avatar) => {
        const p = (people[key] ||= { name, avatar, variants: {} });
        p.variants[name] = (p.variants[name] || 0) + 1;
        if (avatar) p.avatar = avatar;
        return key;
    };
    const wins = [];
    for (const e of facts.wins) {
        if (!e.name || !e.word) continue;
        let key = e.key;
        if (!key) key = Object.keys(people).find((k) => Object.keys(people[k].variants).some((v) => (e.exact ? v === e.name : same(v, e.name)))) || e.name;
        add(key, e.name, e.avatar);
        const prev = wins[wins.length - 1];
        if (prev && prev.key === key && e.t - prev.t < 60 && norm(prev.word).join() === norm(e.word).join()) continue;
        wins.push({ t: e.t, key, word: e.word });
    }
    const planes = facts.planes.map((e) => ({ t: e.t, key: add(e.key || e.name, e.name, e.avatar) }));
    // the crowd of the bottom-right window: one balloon per balloon (a gift of N = N), cakes
    const balloons = [];
    for (const e of facts.balloons) {
        const key = e.key ? add(e.key, e.name, e.avatar) : '';
        for (let i = 0; i < (e.n || 1); i++) balloons.push({ t: e.t, key });
    }
    const cakes = facts.cakes.map((e) => ({ t: e.t, key: e.key ? add(e.key, e.name, e.avatar) : '' }));
    for (const p of Object.values(people)) p.name = Object.entries(p.variants).sort((a, b) => b[1] - a[1])[0][0];
    return { people, wins, planes, balloons, cakes };
}

// race state after each event: one row per count (players with equal counts share a row), bottom-anchored;
// geometry in panel pixels (draw.js): panel tall, rows of ROW from the bottom, PAD inside
export const PANELS = [640, 600], ROW = 74, PAD = 24;
function buildRace(events, PANEL) {
    const totals = {};
    events.forEach(([, n]) => { totals[n] = (totals[n] || 0) + 1; });
    const full = Math.max(1, ...Object.values(totals));       // 100% of a bar = the champion's final count
    const cnt = {}, last = {}, snaps = [{}];
    const H = PANEL - 2 * PAD, cap = Math.floor(H / ROW);
    for (const [t, n] of events) {
        cnt[n] = (cnt[n] || 0) + 1;
        last[n] = t;
        const tiers = [...new Set(Object.values(cnt))].sort((a, b) => b - a);
        const k = Math.min(tiers.length, cap), s = {};
        tiers.forEach((c, r) => {
            // new players of a row come last (drawn under the earlier ones)
            const members = Object.keys(cnt).filter((p) => cnt[p] === c).sort((a, b) => last[a] - last[b]);
            s['g' + c] = { y: r < k ? PAD + H - (k - r) * ROW : PANEL, o: r < k ? 1 : 0, n: c, members, col: TEMPS[Math.min(r, TEMPS.length - 1)] };
        });
        snaps.push(s);
    }
    return { events, snaps, full, panel: PANEL };
}

/**
 * The digest of one stream: {stream, video (the clip's length), speed, date, people, wins, races, shows,
 * streamAt(v), clipOf(t), slowAt(v)}. stream = length of the recording in seconds (the video file; the log's
 * length when there is no file yet). video = clip seconds for everything but the cake shows (they add their
 * own). slow = clip seconds of pause on each win (0: the clock never stops).
 */
export function digestModel(facts, { stream = facts.duration, video = VIDEO, slow = 0 } = {}) {
    const { people, wins, planes, balloons, cakes } = players(facts);
    const countAt = (list, t) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t <= t) lo = m + 1; else hi = m; } return lo; };
    const shows = cakeShows(facts.cakes, stream, facts.fires || []);
    const showTime = shows.reduce((a, s) => a + (s.to - s.from), 0);
    const scale = (video - wins.length * slow) / Math.max(1, stream - showTime);
    const stops = [
        ...shows.map((s) => ({ t: s.split, dur: CAKE_PAUSE, kind: 'cake' })),
        ...(slow ? wins.map((w) => ({ t: w.t, dur: slow, kind: 'win' })) : []),
    ];
    const tl = timeline(stream, scale, shows, stops);
    // clip second -> {t: stream second, k: wins shown, slow: inside a win's pause}
    function streamAt(v) {
        const { t, piece } = tl.at(v);
        return { t, k: countAt(wins, t), slow: piece.kind === 'win' };
    }
    return {
        stream, video: tl.total, slow, date: facts.date, people, wins, planes, balloons, cakes, shows,
        // the stream's temperature per BIN seconds (the curve at the bottom, its dot runs with the clock)
        temp: temperature(bins(facts)),
        speed: Math.round(1 / scale),
        race: buildRace(wins.map((w) => [w.t, w.key]), PANELS[0]),
        planesRace: planes.length ? buildRace(planes.map((p) => [p.t, p.key]), PANELS[1]) : null,
        clipOf: tl.clipOf, streamAt,
        // inside a cake show (played slowly: the video needs every frame there, not one key frame per frame)
        slowAt: (v) => tl.at(v).piece.kind === 'cake',
        // how many of a list (sorted by t) happened by stream second t
        countAt,
    };
}

/** activity per BIN stream seconds: w guessed words, b balloons, p planes, c cakes */
export function bins(facts) {
    const n = Math.max(1, Math.ceil(facts.duration / BIN));
    const out = Array.from({ length: n }, () => ({ w: 0, b: 0, p: 0, c: 0 }));
    const at = (t) => out[Math.min(n - 1, Math.max(0, Math.floor(t / BIN)))];
    facts.wins.forEach((e) => { at(e.t).w++; });
    facts.balloons.forEach((e) => { at(e.t).b += e.n || 1; });
    facts.planes.forEach((e) => { at(e.t).p++; });
    facts.cakes.forEach((e) => { at(e.t).c++; });
    return out;
}

/**
 * The stream's "temperature" per bin, 0..1 (1 = the hottest moment): guessed words weigh 60%, the crowd's
 * activity 40% (balloons x1 + planes x10 + cakes x10), smoothed over ~25 minutes so it reads as warming
 * up / cooling down. Input: bins() or the same shape from Laravel (the archive list).
 */
export function temperature(bs) {
    const n = bs.length;
    if (!n) return [];
    const maxW = Math.max(1, ...bs.map((x) => x.w));
    const act = bs.map((x) => x.b + 10 * x.p + 10 * x.c), maxA = Math.max(1, ...act);
    const T = bs.map((x, i) => 0.6 * x.w / maxW + 0.4 * act[i] / maxA);
    const K = [1, 2, 3, 4, 3, 2, 1];
    const S = T.map((_, i) => K.reduce((a, k, j) => a + k * T[Math.min(n - 1, Math.max(0, i + j - 3))], 0) / 16);
    const max = Math.max(...S) || 1;
    return S.map((v) => v / max);
}

