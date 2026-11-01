// "Champion race" digest: its cover for TikTok, one 1080x1920 picture (the owner's mockup of 31.10).
// Same facts as the clip (model.js): the date, the three hardest guessed words (the longest rounds),
// the podium of the wins race (avatars or initials), the stream's totals, the streamer's handle.
// Deterministic like draw.js, so the archive page and the local pipeline get the same picture.
import { W, H } from './draw.js';

const BLACK = '"Arial Black", Arial, sans-serif', EMOJI = '"Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const black = (px) => `${px}px ${BLACK}`;
const bold = (px) => `bold ${px}px Arial, sans-serif`;
const CYAN = '#22E5FF', PINK = '#FF3EA5', DARK = '#1A0B2E', TILE = '#22123D';
const CHIPS = [['#c6ff00', -2.5], ['#ffffff', 1.5], ['#ffb800', -1.5]];
// podium places left to right: 2nd, 1st, 3rd; x, width, pedestal top, avatar radius, colors (top, bottom, text)
const PODIUM = [
    { place: 2, x: 56, w: 257, top: 1266, r: 92, col: ['#ff9a3c', '#ff6a00', '#ff6a00'], medal: '🥈' },
    { place: 1, x: 337, w: 406, top: 1166, r: 104, col: ['#ff5f7e', '#ff2d55', '#ff2d55'], medal: '🥇' },
    { place: 3, x: 767, w: 257, top: 1321, r: 92, col: ['#ffd84a', '#e0a800', '#ffb800'], medal: '🥉' },
];
const BOTTOM = 1496;
const ini = (n) => (n.match(/[A-Za-zА-Яа-яЁё0-9]/g) || [n[0] || '?']).slice(0, 2).join('').toUpperCase();
const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
// a word for a count, forms "one|few|many" (ru: победа|победы|побед, en: win|wins|wins), by the language's rules
const plural = (lang, n, forms) => {
    const [one, few = one, many = few] = forms.split('|');
    const k = new Intl.PluralRules(lang).select(n);
    return k === 'one' ? one : k === 'few' ? few : many;
};

/** the podium: up to three players by wins; equal counts: who got there first */
export function podium(m) {
    const n = {}, at = {};
    for (const w of m.wins) { n[w.key] = (n[w.key] || 0) + 1; at[w.key] = w.t; }
    return Object.keys(n).sort((a, b) => n[b] - n[a] || at[a] - at[b]).slice(0, 3).map((key) => ({ key, wins: n[key], name: m.people[key].name }));
}

/** the hardest guessed words: the longest rounds somebody won */
export const hardWords = (m, k = 3) => m.rounds.filter((r) => r.key && r.end !== null).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, k).map((r) => r.word);

/**
 * drawCover(ctx, model, {avatars, labels}) paints the cover on a W x H canvas.
 * labels: lang, game, title, subtitle, wins / rounds / balloons / planes (forms "one|few|many"), stream,
 * handle ("@name"; else the LIVE's streamer), footer (the small line under it; none = no line).
 */
export function drawCover(ctx, m, { avatars = new Map(), labels = {} } = {}) {
    const L = {
        lang: 'ru', game: 'УГАДАЙ СЛОВО', title: 'ДАЙДЖЕСТ', subtitle: 'ГОНКА ЧЕМПИОНОВ', wins: 'победа|победы|побед',
        rounds: 'раунд|раунда|раундов', stream: 'эфир', balloons: 'шарик|шарика|шариков', planes: 'самолёт|самолёта|самолётов', ...labels,
    };
    const handle = L.handle || (m.username ? '@' + m.username : '');
    const spaced = (text, x, y, gap) => {
        // letter-spaced text from x (canvas letterSpacing is not everywhere)
        for (const ch of text) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + gap; }
    };
    const fit = (text, font, px, max) => { let p = px; do { ctx.font = font(p); } while (ctx.measureText(text).width > max && --p > 10); return p; };

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

    // header: the game, the date, the title
    ctx.font = black(36); ctx.fillStyle = CYAN; ctx.textAlign = 'left';
    spaced(L.game, 58, 90, 7);
    if (m.date) {
        ctx.font = black(36);
        const w = ctx.measureText(m.date).width + 64;
        ctx.fillStyle = PINK; ctx.beginPath(); ctx.roundRect(1024 - w, 52, w, 72, 36); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(m.date, 1024 - w / 2, 90);
    }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    fit(L.title, black, 150, W - 100);
    ctx.fillText(L.title, 50, 255);
    ctx.font = black(48); ctx.fillStyle = CYAN;
    spaced(L.subtitle, 50, 378, 14);

    // the hardest words as tilted stickers, as many as fit in one row
    const words = hardWords(m).map((w) => w.toUpperCase());
    let px = 32;
    const width = (ws) => ws.reduce((a, w) => { ctx.font = black(px); return a + ctx.measureText(w).width + 56; }, 0) + (ws.length - 1) * 18;
    while (words.length && width(words) > W - 100) { if (px > 26) px--; else words.pop(); }
    let x = 50;
    words.forEach((w, i) => {
        ctx.font = black(px);
        const bw = ctx.measureText(w).width + 56, [bg, a] = CHIPS[i];
        ctx.save(); ctx.translate(x + bw / 2, 484); ctx.rotate((a * Math.PI) / 180);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(-bw / 2, -38, bw, 76, 12); ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = DARK; ctx.textAlign = 'center'; ctx.fillText(w, 0, 3);
        ctx.restore();
        x += bw + 18;
    });

    // the podium
    const top3 = podium(m);
    for (const p of PODIUM) {
        const who = top3[p.place - 1];
        const g = ctx.createLinearGradient(0, p.top, 0, BOTTOM);
        g.addColorStop(0, p.col[0]); g.addColorStop(1, p.col[1]);
        ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(p.x, p.top, p.w, BOTTOM - p.top, [28, 28, 0, 0]); ctx.fill();
        ctx.fillStyle = 'rgba(40,10,10,.75)'; ctx.font = black(p.place === 1 ? 76 : 70); ctx.textAlign = 'center';
        ctx.fillText(String(p.place), p.x + p.w / 2, p.top + 68);
        if (!who) continue;
        const cx = p.x + p.w / 2;
        // from the pedestal up: "N побед", the name (two lines at most), the medal, the avatar
        let y = p.top - 52;
        ctx.textAlign = 'left';
        ctx.font = black(58); const nw = ctx.measureText(String(who.wins)).width;
        const word = plural(L.lang, who.wins, L.wins);
        ctx.font = bold(34); const ww = ctx.measureText(word).width;
        const sx = cx - (nw + 22 + ww) / 2;
        ctx.fillStyle = p.col[2];
        ctx.font = black(58); ctx.fillText(String(who.wins), sx, y);
        ctx.font = bold(34); ctx.fillText(word, sx + nw + 22, y + 6);
        const lines = nameLines(ctx, who.name, p.w + 24);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        y -= 70 + (lines.length - 1) * 52;
        lines.forEach((ln, i) => { ctx.font = bold(lines.size); ctx.fillText(ln, cx, y + i * 52); });
        y -= 82;
        ctx.font = `64px ${EMOJI}`; ctx.fillText(p.medal, cx, y);
        const ay = y - 58 - p.r;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, ay, p.r + 6, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = p.col[1]; ctx.beginPath(); ctx.arc(cx, ay, p.r, 0, 2 * Math.PI); ctx.fill();
        const img = avatars.get(m.people[who.key]?.avatar);
        if (img) {
            ctx.save(); ctx.clip(); ctx.drawImage(img, cx - p.r, ay - p.r, 2 * p.r, 2 * p.r); ctx.restore();
        } else {
            ctx.fillStyle = '#fff'; ctx.font = black(Math.round(p.r * 0.75));
            ctx.fillText(ini(who.name), cx, ay + 4);
        }
    }

    // the stream's totals
    const stats = [
        [m.rounds.length, plural(L.lang, m.rounds.length, L.rounds)], [hm(m.stream), L.stream],
        [m.balloons.length, plural(L.lang, m.balloons.length, L.balloons)], [m.planes.length, plural(L.lang, m.planes.length, L.planes)],
    ];
    stats.forEach(([v, label], i) => {
        label = label.toUpperCase();
        const tx = 56 + i * 247, tw = 227;
        ctx.fillStyle = TILE; ctx.beginPath(); ctx.roundRect(tx, 1576, tw, 148, 26); ctx.fill();
        ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        fit(String(v), black, 56, tw - 30); ctx.fillText(String(v), tx + tw / 2, 1636);
        ctx.fillStyle = '#b9a6e0'; fit(label, black, 26, tw - 24);
        ctx.fillText(label, tx + tw / 2, 1684);
    });

    // the streamer
    ctx.textAlign = 'center';
    if (handle) { ctx.fillStyle = '#fff'; ctx.font = bold(44); ctx.fillText(handle, W / 2, 1812); }
    if (L.footer) { ctx.fillStyle = '#9a9a9a'; fit(L.footer, (p) => `${p}px Arial, sans-serif`, 32, W - 100); ctx.fillText(L.footer, W / 2, 1862); }
}

// a name in at most two lines of the width, the font shrinking until it fits; lines.size = the font's px
function nameLines(ctx, name, max) {
    const words = name.trim().split(/\s+/);
    for (let px = 48; px >= 24; px -= 2) {
        ctx.font = bold(px);
        if (ctx.measureText(name).width <= max && (words.length < 2 || px >= 44)) return Object.assign([name], { size: px });
        if (words.length >= 2) {
            // the split with the shorter longest line
            let best = null;
            for (let i = 1; i < words.length; i++) {
                const ls = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
                const w = Math.max(...ls.map((l) => ctx.measureText(l).width));
                if (!best || w < best.w) best = { ls, w };
            }
            if (best.w <= max) return Object.assign(best.ls, { size: px });
        }
    }
    ctx.font = bold(24);
    let cut = name;
    while (cut.length > 1 && ctx.measureText(cut + '…').width > max) cut = cut.slice(0, -1);
    return Object.assign([cut === name ? name : cut + '…'], { size: 24 });
}
