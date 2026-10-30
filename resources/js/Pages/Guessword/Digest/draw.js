// "Champion race" digest, part 2 of 3: one overlay frame of the 1080x1920 clip on a 2D canvas.
// Deterministic: draw(v) paints clip second v from the model (model.js) and nothing else, so the
// archive page and the local pipeline get the same picture. Layout (the owner's mockup of 30.10):
// top 15% clock, round and date; two race panels (wins, planes); at the bottom the stream's temperature
// curve with a dot running along it, and a window where every balloon rises, every plane flies by and
// cakes pop, with running counters.
import { BIN, TEMPS } from './model.js';

export const W = 1080, H = 1920;
const ANIM = 0.45, STEP = 40, MAXAV = 12, FLASH = 1.0;
const BLACK = '"Arial Black", Arial, sans-serif', BOLD = 'bold {px}px Arial, sans-serif';
const RACES = [304, 956];                       // panel tops; panels: x 20..1060, race.panel tall
const CURVE = { x: 20, y: 1572, w: 700, h: 250 }, WIN = { x: 744, y: 1572, w: 316, h: 250 };
const LIFE = 1.6, FLY = 1.4, POP = 1.0, CROWD = 80;   // clip s a balloon rises / a plane flies / a cake shows; most balloons at once
// a stable pseudo-random 0..1 per event, so the same frame always looks the same
const rnd = (i, salt) => ((Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0) / 4294967296;
const DARK = '#1A0B2E';

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
        tag(`${roundLabel} ${k + 1}`, 28, false, 'rgba(0,0,0,.55)', '#22E5FF');
        tag(m.date, 28, true, '#FF3EA5', '#fff');
        ctx.font = black(96); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        shadowed(ctx, [[0, 4, 18, '#000'], [0, 0, 6, '#000']], () => ctx.fillText(fmt(t), W / 2, 176));
        // the round's word stays on screen for FLASH clip seconds after the win (time keeps running when slow = 0)
        if (k && (slow || v - m.clipOf(m.wins[k - 1].t) < FLASH)) {
            const w = m.wins[k - 1], word = `«${w.word.toUpperCase()}»`, name = m.people[w.key].name;
            ctx.font = black(44); const a = ctx.measureText(word).width;
            ctx.font = bold(28); const b = ctx.measureText(name).width;
            const bw = Math.max(a, b) + 60;
            ctx.fillStyle = '#7CFF4F';
            ctx.beginPath(); ctx.roundRect(W / 2 - bw / 2, 210, bw, 111, 22); ctx.fill();
            ctx.fillStyle = DARK;
            ctx.font = black(44); ctx.fillText(word, W / 2, 210 + 14 + 36);
            ctx.font = bold(28); ctx.fillText(name, W / 2, 210 + 14 + 51 + 27);
        }
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
        const BW = W - 40 - 48, x0 = 44;
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

    return function draw(v) {
        const { t, k, slow } = m.streamAt(v);
        top(t, k, v, slow);
        race(RACES[0], m.race, k, v);
        if (m.planesRace) race(RACES[1], m.planesRace, m.countAt(m.planes, t), v);
        curve(t);
        crowd(t, v);
    };
}
