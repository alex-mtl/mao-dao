// "Champion race" digest, part 2 of 3: one overlay frame of the 1080x1920 clip on a 2D canvas.
// Deterministic: draw(v) paints clip second v from the model (model.js) and nothing else, so the
// archive page and the local pipeline get the same picture. Layout: top 15% clock, round and date;
// two race panels of 42.5% each (wins, planes); the game's plane bobbing in the bottom right corner.
import { PANEL } from './model.js';

export const W = 1080, H = 1920;
const ANIM = 0.45, STEP = 40, MAXAV = 12, FLASH = 1.0;
const BLACK = '"Arial Black", Arial, sans-serif', BOLD = 'bold {px}px Arial, sans-serif';
const RACES = [304, 1116];                      // panel tops; panels: x 20..1060, PANEL tall
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
    const planeCanvas = new OffscreenCanvas(300, 170);
    const pc = planeCanvas.getContext('2d');

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

    // the plane bobs in place: up/down with a slight bank, the propeller flickers as if spinning
    function plane(v) {
        pc.clearRect(0, 0, 300, 170);
        pc.save();
        pc.translate(20, 20);
        pc.scale(260 / 120, 130 / 60);
        for (const [shape, col, alpha = 1] of PLANE) {
            pc.globalAlpha = alpha; pc.fillStyle = col;
            if (typeof shape === 'string') pc.fill(new Path2D(shape));
            else { pc.beginPath(); pc.ellipse(shape[0], shape[1], shape[2], shape[3], 0, 0, 2 * Math.PI); pc.fill(); }
        }
        pc.globalAlpha = 1;
        for (const [cx, r] of [[36, 3.6], [48, 3.2]]) {
            pc.beginPath(); pc.arc(cx, 28, r, 0, 2 * Math.PI);
            pc.fillStyle = '#a8e8ff'; pc.fill(); pc.lineWidth = 1; pc.strokeStyle = '#fff'; pc.stroke();
        }
        pc.fillStyle = '#333'; pc.beginPath(); pc.arc(11, 31, 3, 0, 2 * Math.PI); pc.fill();
        pc.globalAlpha = 0.85; pc.fillStyle = '#555';
        pc.beginPath(); pc.ellipse(9, 31, 2.2, 4 + Math.abs(Math.cos(v * 2 * Math.PI * 7)) * 12, 0, 0, 2 * Math.PI); pc.fill();
        pc.restore();

        ctx.save();
        ctx.translate(W - 56 - 130, 1736 + 65 + Math.sin(v * 2 * Math.PI * 0.6) * 14);
        ctx.rotate(Math.sin(v * 2 * Math.PI * 0.6 + 1) * 4 * Math.PI / 180);
        Object.assign(ctx, { shadowOffsetY: 6, shadowBlur: 10, shadowColor: 'rgba(0,0,0,.6)' });
        ctx.drawImage(planeCanvas, -150, -85);
        ctx.restore();
    }

    return function draw(v) {
        const { t, k, slow } = m.streamAt(v);
        top(t, k, v, slow);
        race(RACES[0], m.race, k, v);
        if (m.planesRace) {
            race(RACES[1], m.planesRace, m.planes.filter((p) => p.t <= t).length, v);
            plane(v);
        }
    };
}
