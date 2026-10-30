// "Champion race" digest, part 1 of 3: the facts of one stream -> players, races, clip time, temperature.
// Pure functions, no DOM: used by the streamer's archive page (Pages/Guessword/Archive.jsx) and by the
// local clips pipeline (tiktok-clips/tools/digest-race.js opens Digest/runner.html in headless Chrome).
// One change here changes both. Drawing: draw.js, video: build.js.

// word-temperature colors of the game (stream-engine/app/web/common/neon.css), hottest first; the last one repeats
export const TEMPS = ['#ff2d55', '#ff6a00', '#ffb800', '#c6ff00', '#00e5ff', '#5b7cff'];
export const VIDEO = 60;      // clip seconds
export const FPS = 30;
export const BIN = 300;       // temperature bins: 5 stream minutes

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
 * Facts from the old events.json of tiktok-clips: [{t, type: round|winner|plane|timeout, who, word, exact}]
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
        balloons: [],
        cakes: [],
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
    return {
        date: start ? String(start.t).slice(0, 10) : '',
        duration: Math.max(0, ...lines.map((l) => l.s || 0)),
        rounds: of('round_start').length,
        wins: of('winner').map((l) => ({ t: l.s, ...who(l.user), word: clean(l.word), exact: true })),
        planes: of('plane').map((l) => ({ t: l.s, ...who(l.user) })),
        // a gift / manual launch of N balloons counts N; cakes: automatic (likes) or [manual]
        balloons: of('balloon').map((l) => ({ t: l.s, n: l.likes ? 1 : (l.count || 1) })),
        cakes: of('cake').map((l) => ({ t: l.s, manual: !!l.manual })),
    };
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
    for (const p of Object.values(people)) p.name = Object.entries(p.variants).sort((a, b) => b[1] - a[1])[0][0];
    return { people, wins, planes };
}

// race state after each event: one row per count (players with equal counts share a row), bottom-anchored;
// geometry in panel pixels (draw.js): PANEL tall, rows of ROW from the bottom, PAD inside
export const PANEL = 796, ROW = 74, PAD = 24;
function buildRace(events) {
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
    return { events, snaps, full };
}

/**
 * The digest of one stream: {stream, video, speed, date, people, wins, races, streamAt(v), clipOf(t)}.
 * stream = length of the recording in seconds (the video file; the log's length when there is no file yet).
 * slow = clip seconds of pause on each win (0: the clock never stops).
 */
export function digestModel(facts, { stream = facts.duration, video = VIDEO, slow = 0 } = {}) {
    const { people, wins, planes } = players(facts);
    const scale = (video - wins.length * slow) / stream;
    // stream second -> clip second (each win adds a pause of slow)
    const clipOf = (t) => t * scale + wins.filter((w) => w.t < t).length * slow;
    // clip second -> {t: stream second, k: wins shown, slow: inside a pause}
    function streamAt(v) {
        let prev = 0, clip = 0;
        for (let i = 0; i < wins.length; i++) {
            const t = wins[i].t, seg = (t - prev) * scale;
            if (v < clip + seg) return { t: prev + (v - clip) / scale, k: i, slow: false };
            clip += seg;
            if (v < clip + slow) return { t, k: i + 1, slow: true };
            clip += slow;
            prev = t;
        }
        return { t: Math.min(stream, prev + (v - clip) / scale), k: wins.length, slow: false };
    }
    return {
        stream, video, slow, date: facts.date, people, wins, planes,
        speed: Math.round(stream / (video - wins.length * slow)),
        race: buildRace(wins.map((w) => [w.t, w.key])),
        planesRace: planes.length ? buildRace(planes.map((p) => [p.t, p.key])) : null,
        clipOf, streamAt,
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

