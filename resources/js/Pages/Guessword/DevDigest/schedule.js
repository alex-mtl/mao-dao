// Development digest, part 1 of 3: the timing. A log of the game's development crawls up at one constant
// speed; the recordings under it run fast (one key frame per ~4 s segment) and slow down to 1x for every new
// animation. Sync: the line after an animation's line arrives only when the animation is over (an empty gap in
// the log), so every animation starts exactly when its line reaches the "now" mark.
// data = tiktok-clips/docs/dev-digest/dev-log.json (tools/dev-digest-data.js).
export const FPS = 30, INTRO = 4, OUTRO = 8, LH = 66;
const WINDOW_MAX = 30 * 60;     // a timelapse stretch shows at most 30 min of its recording

export function schedule(data, T = 600) {
    const heroes = data.heroes;
    const lines = data.lines.map((l, i) => ({ ...l, i }));
    const slot = (l, b) => (l.hero ? Math.max(b, heroes[l.hero].d) : b);
    const startOf = (n, b) => INTRO + lines.slice(0, n).reduce((s, l) => s + slot(l, b), 0);
    let lo = 0.5, hi = 30;                       // the plain step of a line: the video ends exactly at T
    for (let k = 0; k < 60; k++) { const b = (lo + hi) / 2; if (startOf(lines.length, b) + OUTRO > T) hi = b; else lo = b; }
    const STEP = lo, SPEED = LH / STEP;
    lines.forEach((l) => { l.t = startOf(l.i, STEP); l.slot = slot(l, STEP); l.y = (l.t - INTRO) * SPEED; });

    // timelapse stretch of a line: from its moment to the next line's moment in the same recording (or 20 min on)
    const end = (id) => data.streams[id].start + data.streams[id].sec - 2;
    lines.forEach((l, i) => {
        const n = lines[i + 1];
        let b = n && n.stream === l.stream && n.at > l.at ? n.at : l.at + 20 * 60;
        b = Math.min(b, l.at + WINDOW_MAX, end(l.stream));
        l.from = l.at; l.to = Math.max(b, l.at + 1);
        l.lapse = l.slot - (l.hero ? heroes[l.hero].d : 0);   // seconds of video the timelapse gets
    });
    const outroFrom = lines[lines.length - 1];

    /** what the video shows at second v: {stream, at | offset, dense} */
    function sourceAt(v) {
        let l = lines[0];
        for (const x of lines) if (x.t <= v) l = x;
        let u = Math.max(0, v - l.t);
        if (v < INTRO) u = 0;
        if (l.hero && u < heroes[l.hero].d) {
            const h = heroes[l.hero];
            if (h.offset !== undefined) return { stream: h.stream, offset: h.offset + u, dense: true };
            const each = h.d / h.parts.length, k = Math.min(h.parts.length - 1, Math.floor(u / each));
            return { stream: h.parts[k].stream, at: h.parts[k].at + (u - k * each), dense: true };
        }
        if (l.hero) u -= heroes[l.hero].d;
        const len = l === outroFrom ? l.lapse + OUTRO : l.lapse;
        return { stream: l.stream, at: l.from + Math.min(1, u / Math.max(len, 0.001)) * (l.to - l.from), dense: false };
    }

    // "temperature" of the development: commits within 3 h of each line's commit time, smoothed, 0..1
    const raw = lines.map((l) => data.commits.filter((c) => Math.abs(c - commitTime(l)) <= 3 * 3600).length);
    const sm = raw.map((_, i) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) if (raw[i + k] != null) { s += raw[i + k]; n++; } return s / n; });
    const top = Math.max(...sm, 1);
    lines.forEach((l, i) => { l.temp = sm[i] / top; });

    const heroList = lines.filter((l) => l.hero).map((l) => ({ ...heroes[l.hero], key: l.hero, line: l, start: l.t, end: l.t + heroes[l.hero].d }));
    return { T, STEP, SPEED, lines, heroes: heroList, sourceAt, frames: Math.round(T * FPS) };
}

/**
 * The video cut into parts of about `size` seconds, each built and saved on its own (a failure costs one part,
 * a rerun skips the finished ones). Cuts fall on whole seconds outside the 1x stretches, where the sound is
 * silence, so the joins are not heard. [[from, to], ...]
 */
export function parts(plan, size = 30) {
    const inHero = (v) => plan.heroes.some((h) => v > h.start - 0.5 && v < h.end + 0.5);
    const cuts = [0];
    for (let v = size; v < plan.T - size / 2;) {
        let c = v;
        while (c < plan.T && inHero(c)) c += 1;
        if (c >= plan.T - 5) break;
        cuts.push(c);
        v = c + size;
    }
    cuts.push(plan.T);
    return cuts.slice(1).map((to, i) => [cuts[i], to]);
}

const commitTime = (l) => { const [dd, mm] = l.date.split('.'); return Date.parse(`2026-${mm}-${dd}T${l.time}:00-04:00`) / 1000; };
export const dayOf = (date) => { const [dd, mm] = date.split('.').map(Number); return Math.round((Date.UTC(2026, mm - 1, dd) - Date.UTC(2026, 9, 6)) / 864e5) + 1; };
