// Development digest, part 2 of 3: the overlay drawn on top of the recording, 1080x1920. The date at the top
// right, the crawling log of changes in the lower part (lines only, no dates), the development's "temperature"
// in the bottom 10% (as in the "champion race" digest), and "No. 1-3" cards of the first players who launched
// a new animation while it plays. Mockup: tiktok-clips/docs/dev-digest/mockup.html.
import { dayOf, INTRO, LH } from './schedule.js';

export const W = 1080, H = 1920;
const LOG = { x: 36, y: 1150, w: 1008, h: 540 }, BAND = LOG.y + 200;
const TEMP = { x: 20, y: 1728, w: 1040, h: 172 };
const TEMPS = ['#ff2d55', '#ff6a00', '#ffb800', '#c6ff00', '#00e5ff', '#5b7cff'];
const PAL = ['#ff8fb1', '#8fd3ff', '#b8ff8f', '#ffd68f', '#d1a3ff', '#8fffe1', '#ffb38f'];
const hash = (s) => [...s].reduce((a, ch) => (a * 31 + ch.codePointAt(0)) >>> 0, 7);

export function renderer(c, plan, { avatars = {} } = {}) {
    const { lines, heroes, SPEED } = plan;
    const LAST = lines[lines.length - 1];

    function avatar(x, y, r, name, login) {
        c.save();
        c.beginPath(); c.arc(x, y, r, 0, 7);
        const img = avatars[login];
        if (img) { c.clip(); c.drawImage(img, x - r, y - r, 2 * r, 2 * r); c.restore(); c.save(); c.beginPath(); c.arc(x, y, r, 0, 7); }
        else {
            c.fillStyle = PAL[hash(name) % PAL.length]; c.fill();
            c.fillStyle = '#1a1a1a'; c.font = `700 ${r}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText([...name][0].toUpperCase(), x, y + r * 0.05);
        }
        c.lineWidth = r * 0.08; c.strokeStyle = '#fff'; c.stroke();
        c.restore();
    }

    function date(cur) {
        const x = W - 36, y = 44;
        c.save(); c.textAlign = 'right';
        c.font = '900 92px system-ui';
        const w = Math.max(c.measureText(cur.date).width, 220) + 56;
        c.fillStyle = 'rgba(10,10,16,.62)'; c.beginPath(); c.roundRect(x - w, y, w, 170, 28); c.fill();
        c.fillStyle = '#ffcc33'; c.fillText(cur.date, x - 28, y + 100);
        c.fillStyle = '#c9cede'; c.font = '700 34px system-ui'; c.fillText(`день ${dayOf(cur.date)}`, x - 28, y + 148);
        c.restore();
    }

    function log(scroll, cur) {
        c.save();
        const g = c.createLinearGradient(0, LOG.y, 0, LOG.y + LOG.h);
        g.addColorStop(0, 'rgba(8,9,13,0)'); g.addColorStop(0.18, 'rgba(8,9,13,.78)'); g.addColorStop(1, 'rgba(8,9,13,.86)');
        c.fillStyle = g; c.fillRect(0, LOG.y, W, LOG.h + 40);
        c.beginPath(); c.rect(0, LOG.y, W, LOG.h); c.clip();
        c.fillStyle = 'rgba(255,204,51,.12)'; c.fillRect(LOG.x - 12, BAND - 46, LOG.w + 24, LH);
        c.fillStyle = '#ffcc33'; c.fillRect(LOG.x - 12, BAND - 46, 8, LH);
        for (const l of lines) {
            const y = BAND + l.y - scroll;
            if (y < LOG.y - 20 || y > LOG.y + LOG.h + 50) continue;
            const now = l === cur && y > BAND - LH, past = l.i < cur.i || (l === cur && !now);
            const fade = Math.max(0, Math.min(1, (y - LOG.y) / 120)) * Math.max(0, Math.min(1, (LOG.y + LOG.h - y) / 60));
            c.globalAlpha = fade * (now ? 1 : past ? 0.38 : 0.7);
            c.textAlign = 'left'; c.font = `${now ? 800 : 500} ${now ? 42 : 38}px system-ui`;
            let x = LOG.x + 14;
            if (l.hero) { c.fillStyle = '#ff5a8a'; c.beginPath(); c.arc(x + 9, y - 13, 9, 0, 7); c.fill(); x += 32; }
            c.fillStyle = '#fff'; c.fillText(l.text, x, y);
        }
        // the last line has passed: the closing words instead of the log
        const a = Math.max(0, Math.min(1, (scroll - LAST.y - LAST.slot * SPEED) / SPEED));
        if (a) {
            c.globalAlpha = a; c.textAlign = 'center';
            c.fillStyle = '#ffcc33'; c.font = '900 72px system-ui'; c.fillText('25 дней в прямом эфире', W / 2, LOG.y + 250);
            c.fillStyle = '#e8eaf0'; c.font = '500 44px system-ui'; c.fillText('спасибо всем, кто играл', W / 2, LOG.y + 330);
        }
        c.restore();
    }

    function temperature(v) {
        const R = TEMP, X = (t) => R.x + 16 + Math.max(0, Math.min(1, (t - INTRO) / (LAST.t - INTRO))) * (R.w - 32);
        const pts = lines.map((l) => [X(l.t), R.y + R.h - 16 - l.temp * (R.h - 44)]);
        c.save(); c.fillStyle = 'rgba(18,8,34,.78)'; c.beginPath(); c.roundRect(R.x, R.y, R.w, R.h, 24); c.fill(); c.clip();
        const g = c.createLinearGradient(0, R.y, 0, R.y + R.h); TEMPS.forEach((col, i) => g.addColorStop(i / (TEMPS.length - 1), col));
        const line = new Path2D(); pts.forEach(([x, y], i) => (i ? line.lineTo(x, y) : line.moveTo(x, y)));
        const area = new Path2D(line); area.lineTo(pts[pts.length - 1][0], R.y + R.h); area.lineTo(pts[0][0], R.y + R.h); area.closePath();
        const nx = X(v);
        c.fillStyle = g; c.globalAlpha = 0.16; c.fill(area);
        c.save(); c.beginPath(); c.rect(R.x, R.y, nx - R.x, R.h); c.clip(); c.globalAlpha = 0.45; c.fill(area); c.restore();
        c.globalAlpha = 1; c.strokeStyle = g; c.lineWidth = 5; c.lineJoin = 'round'; c.stroke(line);
        for (const h of heroes) {
            c.fillStyle = v >= h.start ? '#ff5a8a' : 'rgba(255,90,138,.4)';
            c.beginPath(); c.arc(X(h.start), R.y + R.h - 10, 6, 0, 7); c.fill();
        }
        let ny = pts[pts.length - 1][1];
        for (let i = 1; i < pts.length; i++) if (nx <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; ny = y0 + (y1 - y0) * ((nx - x0) / Math.max(1, x1 - x0)); break; }
        c.globalAlpha = 0.5; c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(nx, R.y); c.lineTo(nx, R.y + R.h); c.stroke();
        c.lineWidth = 3; c.beginPath(); c.arc(nx, ny, 22, 0, 7); c.stroke();
        c.globalAlpha = 1; c.fillStyle = '#fff'; c.beginPath(); c.arc(nx, ny, 12, 0, 7); c.fill();
        c.fillStyle = 'rgba(255,255,255,.55)'; c.font = '600 22px system-ui'; c.textAlign = 'left'; c.fillText('06.10', R.x + 20, R.y + 30);
        c.textAlign = 'right'; c.fillText('30.10', R.x + R.w - 20, R.y + 30);
        c.restore();
    }

    // "No. 1-3" cards: slide in from the right, in the middle of the frame above the log
    function firsts(h, p) {
        h.firsts.forEach(([name, login], k) => {
            const a = Math.min(1, Math.max(0, (p - 0.12 - k * 0.12) * 6), Math.max(0, (1 - p) * 12));
            if (!a) return;
            const y = LOG.y - 560 + k * 170, x = W - 736 + (1 - Math.min(1, (p - 0.12 - k * 0.12) * 6)) * 760;
            c.save(); c.globalAlpha = a; c.fillStyle = 'rgba(10,10,16,.78)';
            c.beginPath(); c.roundRect(x, y, 700, 150, 75); c.fill();
            avatar(x + 75, y + 75, 60, name, login);
            c.fillStyle = '#ffcc33'; c.font = '800 32px system-ui'; c.textAlign = 'left'; c.fillText(`№${k + 1} ${h.what}`, x + 160, y + 58);
            c.fillStyle = '#fff'; c.font = '700 52px system-ui'; c.fillText(name, x + 160, y + 114);
            c.restore();
        });
    }

    /** the overlay at video second v (the recording's picture is already on the canvas) */
    return function draw(v) {
        const scroll = Math.max(0, v - INTRO) * SPEED;
        let cur = lines[0];
        for (const l of lines) if (l.y <= scroll + 0.5) cur = l;
        if (v < INTRO) {
            c.save(); c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, 0, W, H);
            c.textAlign = 'center'; c.fillStyle = '#ffcc33'; c.font = '900 96px system-ui'; c.fillText('Как мы делали игру', W / 2, 640);
            c.fillStyle = '#e8eaf0'; c.font = '500 46px system-ui'; c.fillText('06.10 → 30.10.2026, всё в прямом эфире', W / 2, 730);
            c.restore();
        } else {
            const h = heroes.find((x) => v >= x.start && v < x.end);
            if (h?.firsts) firsts(h, (v - h.start) / h.d);
            date(cur);
        }
        log(scroll, cur);
        temperature(v);
    };
}
