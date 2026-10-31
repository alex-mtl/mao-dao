// "Champion race" digest, part 2 of 3: one overlay frame of the 1080x1920 clip on a 2D canvas.
// Deterministic: draw(v) paints clip second v from the model (model.js) and nothing else, so the
// archive page and the local pipeline get the same picture. Layout (the owner's mockup of 30.10):
// top 15% clock, round and date; two race panels (wins, planes), the wins race with a rounds window (each round
// rises, turns into its word, green guessed / red not, then flies to the host zone as a sticker under the panels,
// mockup of 31.10); at the bottom the stream's temperature
// curve with a dot running along it, and a window where every balloon rises, every plane flies by and
// cakes pop, with running counters.
import { BIN, TEMPS } from './model.js';

export const W = 1080, H = 1920;
const ANIM = 0.45, STEP = 40, MAXAV = 12;
const BLACK = '"Arial Black", Arial, sans-serif', BOLD = 'bold {px}px Arial, sans-serif';
const RACES = [304, 956];                       // panel tops; panels: x 20..1060, race.panel tall
const CURVE = { x: 20, y: 1572, w: 700, h: 250 }, WIN = { x: 744, y: 1572, w: 316, h: 250 };
// the rounds window (bottom right of the wins race); a round's word sits there SHOW clip s, flies FLYW to its sticker;
// the host's zone keeps the last KEEP stickers, the clock stays free
const RWIN = { x: 724, y: 304 + 640 - 16 - 250, w: 316, h: 250 }, RISE = 0.35, SHOW = 0.3, FLYW = 0.55, POPB = 0.2, KEEP = 10;
const HOST = { x0: 120, x1: 960, y0: 120, y1: 600 }, CLOCK = { x0: 250, x1: 830, y0: 100, y1: 250 };
const GREEN = '#7CFF4F', RED = '#ff2d55';
const LIFE = 1.6, FLY = 1.4, POP = 1.0, CROWD = 80;   // clip s a balloon rises / a plane flies / a cake shows; most balloons at once
// a stable pseudo-random 0..1 per event, so the same frame always looks the same
const rnd = (i, salt) => ((Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0) / 4294967296;
const DARK = '#1A0B2E';

const dur = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = String(s % 60).padStart(2, '0'); return h ? h + ':' + String(mm).padStart(2, '0') + ':' + ss : mm + ':' + ss; };
const fmt = (s) => { s = Math.floor(s); return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const ini = (n) => (n.match(/[A-Za-zА-Яа-яЁё0-9]/g) || [n[0] || '?']).slice(0, 2).join('').toUpperCase();
const black = (px) => `${px}px ${BLACK}`;
const bold = (px) => BOLD.replace('{px}', px);

// the game's plane (stream-engine/app/web/common/plane.js), viewBox 120x60
const PLANE = [
    ['M100 30 L118 12 L112 30 Z', '#ff2d55'], ['M98 30 L116 40 L108 30 Z', '#d1003a'],
    [[58, 31, 46, 12], '#ff2d55'], [[56, 27, 40, 5], '#ff7a98', 0.7],
    ['M14 31 C 14 24, 20 21, 26 21 L 26 41 C 20 41, 14 38, 14 31 Z', '#ffd84a'],
    ['M44 33 L74 33 L86 52 L64 52 Z', '#c4002f'], ['M46 29 L70 29 L80 12 L60 12 Z', '#e0183f'],
];

function shadowed(ctx, shadows, paint) {
    for (const [x, y, blur, col] of shadows) {
        ctx.save();
        Object.assign(ctx, { shadowOffsetX: x, shadowOffsetY: y, shadowBlur: blur, shadowColor: col });
        paint();
        ctx.restore();
    }
    paint();
}

/**
 * renderer(ctx, model, {avatars, labels}) -> draw(v). ctx: 2D context of a W x H canvas.
 * avatars: Map avatar id -> image (drawn in the circles; initials without one). labels.round: "ROUND".
 */
export function renderer(ctx, m, { avatars = new Map(), labels = {} } = {}) {
    const roundLabel = labels.round || 'РАУНД';

    function tag(text, x, right, bg, color) {
        ctx.font = black(32);
        const w = ctx.measureText(text).width + 40, h = 65, left = right ? W - x - w : x;
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.roundRect(left, 28, w, h, 16); ctx.fill();
        ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, left + w / 2, 28 + h / 2 + 3.5);
    }

    function top(t, k, v, slow) {
        tag(`${roundLabel} ${m.roundAt(t) || k + 1}`, 28, false, 'rgba(0,0,0,.55)', '#22E5FF');
        tag(m.date, 28, true, '#FF3EA5', '#fff');
        ctx.font = black(96); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        shadowed(ctx, [[0, 4, 18, '#000'], [0, 0, 6, '#000']], () => ctx.fillText(fmt(t), W / 2, 176));
    }

    function avatar(x, y, col, key, text) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x + 33, y + 33, 33, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x + 33, y + 33, 28, 0, 2 * Math.PI); ctx.fill();
        const img = key && avatars.get(m.people[key]?.avatar);
        if (img) {
            ctx.save(); ctx.clip(); ctx.drawImage(img, x + 5, y + 5, 56, 56); ctx.restore();
            return;
        }
        ctx.fillStyle = col === DARK ? '#fff' : DARK;
        ctx.font = black(24); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 33, y + 34);
    }

    function race(top0, r, k, v) {
        ctx.save();
        const PANEL = r.panel;
        ctx.fillStyle = 'rgba(18,8,34,.72)';
        ctx.beginPath(); ctx.roundRect(20, top0, W - 40, PANEL, 30); ctx.fill(); ctx.clip();
        const cur = r.snaps[k], old = r.snaps[Math.max(0, k - 1)];
        // dense events (e.g. a plane every 0.25 clip s) get a shorter transition so each one still finishes
        const gap = k && k < r.events.length ? m.clipOf(r.events[k][0]) - m.clipOf(r.events[k - 1][0]) : ANIM;
        const anim = Math.max(0.1, Math.min(ANIM, gap));
        const p = k ? Math.min(1, (v - m.clipOf(r.events[k - 1][0])) / anim) : 1, e = p * p * (3 - 2 * p);
        const x0 = 44, BW = r === m.race ? RWIN.x - 16 - x0 : W - 40 - 48;
        for (const key of Object.keys(cur)) {
            const b = cur[key];
            // rows are keyed by count: a player moving up starts from the row he left, so the bar grows instead of popping in
            const a = old[key] || Object.values(old).find((g) => g.members.some((x) => b.members.includes(x))) || { y: PANEL, o: 0, n: 0 };
            const y = top0 + a.y + (b.y - a.y) * e, o = a.o + (b.o - a.o) * e, n = a.n + (b.n - a.n) * e;
            const shown = b.members.slice(0, MAXAV), more = b.members.length - shown.length;
            const avW = 66 + (shown.length - 1 + (more ? 1 : 0)) * STEP;
            const w = Math.max(b.members.length > 1 ? avW + 90 : 120, (n / r.full) * BW);
            ctx.globalAlpha = o;
            ctx.fillStyle = b.col;
            ctx.beginPath(); ctx.roundRect(x0, y + 4, w, 58, [33, 14, 14, 33]); ctx.fill();
            // the first avatar lies on top: draw from the last one
            if (more) avatar(x0 + shown.length * STEP, y, DARK, '', '+' + more);
            for (let i = shown.length - 1; i >= 0; i--) avatar(x0 + i * STEP, y, b.col, shown[i], ini(m.people[shown[i]].name));
            if (b.members.length === 1) {
                ctx.font = bold(32); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
                shadowed(ctx, [[0, 2, 6, '#000'], [0, 0, 3, '#000']], () => ctx.fillText(m.people[b.members[0]].name, x0 + 82, y + 34));
            }
            ctx.font = black(32); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = DARK;
            ctx.fillText(String(b.n), x0 + w - 20, y + 34);
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }

    // the game's plane, w wide around (x, y), nose to the left as it flies in the game, propeller flickering
    function plane(x, y, w, v) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(w / 120, w / 120);
        ctx.translate(-60, -30);
        for (const [shape, col, alpha = 1] of PLANE) {
            ctx.globalAlpha = alpha; ctx.fillStyle = col;
            if (typeof shape === 'string') ctx.fill(new Path2D(shape));
            else { ctx.beginPath(); ctx.ellipse(shape[0], shape[1], shape[2], shape[3], 0, 0, 2 * Math.PI); ctx.fill(); }
        }
        ctx.globalAlpha = 1;
        for (const [cx, r] of [[36, 3.6], [48, 3.2]]) {
            ctx.beginPath(); ctx.arc(cx, 28, r, 0, 2 * Math.PI);
            ctx.fillStyle = '#a8e8ff'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
        ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(11, 31, 3, 0, 2 * Math.PI); ctx.fill();
        ctx.globalAlpha = 0.85; ctx.fillStyle = '#555';
        ctx.beginPath(); ctx.ellipse(9, 31, 2.2, 4 + Math.abs(Math.cos(v * 2 * Math.PI * 7)) * 12, 0, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
    }

    // a small round avatar (initials without a picture) of somebody in the window
    function face(key, x, y, r, col) {
        const p = key && m.people[key];
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x, y, r - 2.5, 0, 2 * Math.PI); ctx.fill();
        const img = p && avatars.get(p.avatar);
        if (img) { ctx.save(); ctx.clip(); ctx.drawImage(img, x - r + 2.5, y - r + 2.5, 2 * r - 5, 2 * r - 5); ctx.restore(); return; }
        if (!p) return;
        ctx.fillStyle = DARK; ctx.font = black(Math.round(r * 0.8)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(ini(p.name), x, y + 1);
    }

    // the curve: the stream's temperature (hot = top, colored like the game's word temperature), the part
    // already played filled brighter, a line and a dot running along it with the clock
    const pts = m.temp.map((T, i) => [
        CURVE.x + Math.min(1, ((i + 0.5) * BIN) / m.stream) * CURVE.w,
        CURVE.y + CURVE.h - 14 - T * (CURVE.h - 40),
    ]);
    function curve(t) {
        ctx.save();
        ctx.fillStyle = 'rgba(18,8,34,.72)';
        ctx.beginPath(); ctx.roundRect(CURVE.x, CURVE.y, CURVE.w, CURVE.h, 24); ctx.fill(); ctx.clip();
        if (pts.length) {
            const g = ctx.createLinearGradient(0, CURVE.y, 0, CURVE.y + CURVE.h);
            TEMPS.forEach((c, i) => g.addColorStop(i / (TEMPS.length - 1), c));
            const all = [[CURVE.x, pts[0][1]], ...pts, [CURVE.x + CURVE.w, pts[pts.length - 1][1]]];
            const line = new Path2D();
            all.forEach(([x, y], i) => (i ? line.lineTo(x, y) : line.moveTo(x, y)));
            const area = new Path2D(line);
            area.lineTo(CURVE.x + CURVE.w, CURVE.y + CURVE.h);
            area.lineTo(CURVE.x, CURVE.y + CURVE.h);
            area.closePath();
            const nx = CURVE.x + Math.min(1, t / m.stream) * CURVE.w;
            ctx.fillStyle = g;
            ctx.globalAlpha = 0.18; ctx.fill(area);
            ctx.save(); ctx.beginPath(); ctx.rect(CURVE.x, CURVE.y, nx - CURVE.x, CURVE.h); ctx.clip();
            ctx.globalAlpha = 0.45; ctx.fill(area); ctx.restore();
            ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.stroke(line);
            let ny = all[all.length - 1][1];
            for (let i = 1; i < all.length; i++) {
                const [x0, y0] = all[i - 1], [x1, y1] = all[i];
                if (nx <= x1) { ny = y0 + (y1 - y0) * ((nx - x0) / Math.max(1, x1 - x0)); break; }
            }
            ctx.globalAlpha = 0.5; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(nx, CURVE.y); ctx.lineTo(nx, CURVE.y + CURVE.h); ctx.stroke();
            ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(nx, ny, 26, 0, 2 * Math.PI); ctx.stroke();
            ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(nx, ny, 14, 0, 2 * Math.PI); ctx.fill();
        }
        ctx.restore();
    }

    // events of a list (sorted by t) on screen at clip second v for life clip seconds: [index, age], newest max
    function alive(list, v, life, max) {
        const out = [];
        for (let i = m.countAt(list, m.streamAt(v).t) - 1; i >= 0 && out.length < max; i--) {
            const age = v - m.clipOf(list[i].t);
            if (age >= life) break;
            if (age >= 0) out.push([i, age]);
        }
        return out.reverse();
    }

    // the window: every balloon rises like a fountain, every plane flies across, cakes pop; counters on top
    function crowd(t, v) {
        ctx.save();
        ctx.fillStyle = 'rgba(18,8,34,.72)';
        ctx.beginPath(); ctx.roundRect(WIN.x, WIN.y, WIN.w, WIN.h, 24); ctx.fill(); ctx.clip();
        for (const [i, age] of alive(m.balloons, v, LIFE, CROWD)) {
            const k = age / LIFE, col = TEMPS[Math.floor(rnd(i, 1) * TEMPS.length)];
            const x = WIN.x + 30 + rnd(i, 2) * (WIN.w - 60) + Math.sin(age * 4 + i) * 10;
            const y = WIN.y + WIN.h + 40 - k * (WIN.h + 90) * (0.75 + rnd(i, 3) * 0.35);
            ctx.globalAlpha = k > 0.8 ? (1 - k) * 5 : 1;
            ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x, y + 28); ctx.quadraticCurveTo(x - 6, y + 42, x + 2, y + 56); ctx.stroke();
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.ellipse(x, y, 23, 28, 0, 0, 2 * Math.PI); ctx.fill();
            face(m.balloons[i].key, x, y - 2, 16, col);
        }
        ctx.globalAlpha = 1;
        for (const [i, age] of alive(m.planes, v, FLY, 12)) {
            const k = age / FLY;
            const x = WIN.x + WIN.w + 80 - k * (WIN.w + 160), y = WIN.y + 80 + rnd(i, 4) * (WIN.h - 120) + Math.sin(age * 5 + i) * 6;
            plane(x, y, 120, v);
            face(m.planes[i].key, x + 6, y - 24, 15, '#ff2d55');
        }
        for (const [i, age] of alive(m.cakes, v, POP, 6)) {
            const k = age / POP;
            ctx.globalAlpha = k > 0.6 ? (1 - k) * 2.5 : 1;
            ctx.font = `${Math.round(40 + k * 40)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('🎂', WIN.x + 60 + rnd(i, 5) * (WIN.w - 120), WIN.y + 90 + rnd(i, 6) * 100);
        }
        ctx.globalAlpha = 1;
        const counts = `🎈${m.countAt(m.balloons, t)}  ✈${m.countAt(m.planes, t)}  🎂${m.countAt(m.cakes, t)}`;
        ctx.font = black(28); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        shadowed(ctx, [[0, 2, 6, '#000']], () => ctx.fillText(counts, WIN.x + WIN.w / 2, WIN.y + 30));
        ctx.restore();
    }

    // --- rounds: the window, the flying word, the stickers ---
    const fit = (text, font, px, max) => { let p = px; do { ctx.font = font(p); } while (ctx.measureText(text).width > max && --p > 10); return p; };
    const nick = (key) => { const n = m.people[key]?.name || ''; return n.length > 11 ? n.slice(0, 10) + '…' : n; };
    // a well mixed 0..1 per (i, salt): rnd() above is fine for one value, but its x and y of neighbouring rounds
    // move together (the stickers lined up on a diagonal)
    const mix = (i, s) => {
        let x = Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(s + 1, 0x85EBCA77);
        x ^= x >>> 16; x = Math.imul(x, 0x7FEB352D); x ^= x >>> 15; x = Math.imul(x, 0x846CA68B); x ^= x >>> 16;
        return (x >>> 0) / 4294967296;
    };
    // every round's spot in the host's zone, fixed up front: of 12 random places off the clock, the one farthest
    // from the stickers still on screen (the last KEEP)
    const spots = {};
    m.rounds.forEach((rd, j) => {
        const near = m.rounds.slice(Math.max(0, j - KEEP), j).map((x) => spots[x.n]);
        let best = null, bestD = -1;
        for (let s = 0; s < 12; s++) {
            const x = HOST.x0 + mix(rd.n, 2 * s) * (HOST.x1 - HOST.x0), y = HOST.y0 + mix(rd.n, 2 * s + 1) * (HOST.y1 - HOST.y0);
            if (x > CLOCK.x0 && x < CLOCK.x1 && y > CLOCK.y0 && y < CLOCK.y1) continue;
            const d = Math.min(1e9, ...near.map(([a, b]) => Math.hypot((a - x) / 1.6, b - y)));
            if (d > bestD) { bestD = d; best = [x, y]; }
        }
        // a long word moves in from the edge so the whole sticker (and its badges) stays in the frame
        const half = ((Math.min(300, rd.word.length * 24) + 44) * 0.85) / 2 + 30;
        const [bx, by] = best || [HOST.x0, HOST.y1];
        spots[rd.n] = [Math.min(W - half, Math.max(half, bx)), by, (mix(rd.n, 99) - 0.5) * 22];
    });
    const spot = (n) => spots[n];
    // the word box (sticker look) centered at (0, 0) of the current transform; returns its size
    function wordBox(rd) {
        const word = rd.word.toUpperCase();
        const p = fit(word, black, 34, 300);
        const bw = Math.max(150, ctx.measureText(word).width + 44), bh = 74;
        ctx.save();
        Object.assign(ctx, { shadowOffsetY: 5, shadowBlur: 12, shadowColor: 'rgba(0,0,0,.55)' });
        ctx.fillStyle = rd.key ? GREEN : RED;
        ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 14); ctx.fill();
        ctx.restore();
        ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = DARK; ctx.font = black(p); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(word, 0, 8);
        return [bw, bh];
    }
    // a stuck word: badges on its border, avatar + nick top left, the round's time top right
    function sticker(rd, alpha, badge) {
        const [x, y, a] = spot(rd.n);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.translate(x, y); ctx.rotate(a * Math.PI / 180); ctx.scale(0.85, 0.85);
        const [bw, bh] = wordBox(rd);
        if (badge > 0) {
            const name = rd.key ? nick(rd.key) : 'никто';
            ctx.save(); ctx.translate(-bw / 2 - 6, -bh / 2); ctx.scale(badge, badge);
            ctx.font = bold(17); const nw = ctx.measureText(name).width;
            ctx.fillStyle = DARK; ctx.beginPath(); ctx.roundRect(-10, -20, 56 + nw, 40, 20); ctx.fill();
            if (rd.key) face(rd.key, 10, 0, 20, TEMPS[rd.n % TEMPS.length]);
            else {
                ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(10, 0, 20, 0, 2 * Math.PI); ctx.fill();
                ctx.font = '20px "Segoe UI Emoji", "Noto Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🖤', 10, 1);
            }
            ctx.fillStyle = '#fff'; ctx.font = bold(17); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(name, 36, 1);
            ctx.restore();
            const tx = dur(rd.end - rd.start);
            ctx.save(); ctx.translate(bw / 2 + 6, -bh / 2 + 2); ctx.scale(badge, badge);
            ctx.font = bold(18); const tw = ctx.measureText(tx).width + 20;
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(-tw, -16, tw, 32, 12); ctx.fill();
            ctx.fillStyle = DARK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tx, -tw / 2, 1);
            ctx.restore();
        }
        ctx.restore();
    }
    const ended = m.rounds.filter((rd) => rd.end !== null);
    const third = RWIN.y + RWIN.h / 3 + 20, bottom = RWIN.y + RWIN.h + 30;
    // where a round's card is in the window at clip second v: it rises once the word before it starts to leave
    function cardY(i, v) {
        const rd = m.rounds[i], prev = m.rounds[i - 1];
        const from = Math.max(m.clipOf(rd.start), prev && prev.end !== null ? m.clipOf(prev.end) + SHOW * 0.6 : 0);
        const p = Math.min(1, Math.max(0, (v - from) / RISE));
        return bottom - (bottom - third) * (1 - (1 - p) ** 3);
    }
    // stickers that landed by v (under the race panels): the last KEEP, the one pushed out fades
    function stickers(v) {
        const landed = ended.filter((rd) => v >= m.clipOf(rd.end) + SHOW + FLYW);
        const last = landed.length ? m.clipOf(landed[landed.length - 1].end) + SHOW + FLYW : 0;
        landed.slice(Math.max(0, landed.length - KEEP - 1)).forEach((rd, j) => {
            const alpha = landed.length > KEEP && j === 0 ? Math.max(0, 1 - (v - last) / 0.3) : 1;
            if (alpha > 0) sticker(rd, alpha, Math.min(1, (v - m.clipOf(rd.end) - SHOW - FLYW) / POPB));
        });
    }
    // a counter swells for a moment when it ticks
    function bumpOf(list, t, v) {
        const n = m.countAt(list, t);
        if (!n) return 1;
        const a = v - m.clipOf(list[n - 1].t);
        return a < 0.25 ? 1.35 - a * 1.4 : 1;
    }
    function roundsWindow(t, v) {
        ctx.save();
        ctx.fillStyle = 'rgba(18,8,34,.72)';
        ctx.beginPath(); ctx.roundRect(RWIN.x, RWIN.y, RWIN.w, RWIN.h, 24); ctx.fill(); ctx.clip();
        const cur = m.roundAt(t) - 1;
        // the running round: "Round N · time · ???"
        if (cur >= 0 && (m.rounds[cur].end === null || m.rounds[cur].end > t)) {
            const rd = m.rounds[cur], y = cardY(cur, v), text = `Раунд ${rd.n} · ${dur(t - rd.start)} · ???`;
            const p = fit(text, black, 22, RWIN.w - 56), w = ctx.measureText(text).width + 32;
            ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.roundRect(RWIN.x + RWIN.w / 2 - w / 2, y - 22, w, 44, 14); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = black(p);
            ctx.fillText(text, RWIN.x + RWIN.w / 2, y + 2);
        }
        // a just finished round: its word where its card was (green guessed, red not), the winner and the time under it
        m.rounds.forEach((rd, i) => {
            if (rd.end === null) return;
            const a = v - m.clipOf(rd.end);
            if (a < 0 || a >= SHOW) return;
            const y = cardY(i, m.clipOf(rd.end)), s = 1 + 0.2 * Math.max(0, 1 - a / 0.12);
            const word = `«${rd.word.toUpperCase()}»`, sub = (rd.key ? nick(rd.key) + ' · ' : '') + dur(rd.end - rd.start);
            const p = fit(word, black, 32, RWIN.w - 60), w = Math.min(RWIN.w - 20, ctx.measureText(word).width + 36);
            ctx.save(); ctx.translate(RWIN.x + RWIN.w / 2, y); ctx.scale(s, s);
            ctx.fillStyle = rd.key ? GREEN : RED; ctx.beginPath(); ctx.roundRect(-w / 2, -38, w, 76, 14); ctx.fill();
            ctx.fillStyle = DARK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = black(p); ctx.fillText(word, 0, -10);
            ctx.font = bold(18); ctx.fillText(sub, 0, 22);
            ctx.restore();
        });
        // counters: missed rounds on the left, guessed (= the race's wins) on the right
        const pill = (text, right, bg, b) => {
            ctx.font = black(28);
            const w = ctx.measureText(text).width + 28, x = right ? RWIN.x + RWIN.w - 10 - w : RWIN.x + 10;
            ctx.save(); ctx.translate(x + w / 2, RWIN.y + 34); ctx.scale(b, b);
            ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(-w / 2, -24, w, 48, 14); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 2);
            ctx.restore();
        };
        pill(`🖤 ${m.countAt(m.lost, t)}`, false, 'rgba(255,45,85,.2)', bumpOf(m.lost, t, v));
        pill(`❤️ ${m.countAt(m.wins, t)}`, true, 'rgba(124,255,79,.2)', bumpOf(m.wins, t, v));
        ctx.restore();
    }
    // words on their way from the window to their spot, over everything
    function flying(v) {
        m.rounds.forEach((rd, i) => {
            if (rd.end === null) return;
            const a = v - m.clipOf(rd.end) - SHOW;
            if (a < 0 || a >= FLYW) return;
            const p = 1 - (1 - a / FLYW) ** 2, sx = RWIN.x + RWIN.w / 2, sy = cardY(i, m.clipOf(rd.end)), [x, y, ang] = spot(rd.n);
            const cx = (sx + x) / 2 + 80, cy = Math.min(sy, y) - 220;
            const fx = (1 - p) ** 2 * sx + 2 * (1 - p) * p * cx + p * p * x, fy = (1 - p) ** 2 * sy + 2 * (1 - p) * p * cy + p * p * y;
            ctx.save(); ctx.translate(fx, fy); ctx.rotate((ang * p + 25 * (1 - p)) * Math.PI / 180); ctx.scale(1.2 - 0.2 * p, 1.2 - 0.2 * p);
            wordBox(rd);
            ctx.restore();
        });
    }

    return function draw(v) {
        const { t, k, slow } = m.streamAt(v);
        stickers(v);
        top(t, k, v, slow);
        race(RACES[0], m.race, k, v);
        if (m.planesRace) race(RACES[1], m.planesRace, m.countAt(m.planes, t), v);
        curve(t);
        crowd(t, v);
        roundsWindow(t, v);
        flying(v);
    };
}
