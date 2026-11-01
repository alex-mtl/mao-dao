// "Champion race" digest: its cover for TikTok, one 1080x1440 picture (3:4:
// TikTok crops an uploaded cover to that, the profile grid shows it so; the owner's mockup of 31.10).
// Same facts as the clip (model.js): the date, the three hardest guessed words (the longest rounds),
// the podium of the wins race (avatars or initials), the stream's totals, the streamer's handle.
// Deterministic like draw.js, so the archive page and the local pipeline get the same picture.
export const W = 1080, H = 1440;

const BLACK = '"Arial Black", Arial, sans-serif', EMOJI = '"Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const black = (px) => `${px}px ${BLACK}`;
const bold = (px) => `bold ${px}px Arial, sans-serif`;
const CYAN = '#22E5FF', PINK = '#FF3EA5', DARK = '#1A0B2E', TILE = '#22123D';
const CHIPS = [['#c6ff00', -2.5], ['#ffffff', 1.5], ['#ffb800', -1.5]];
// podium places left to right: 2nd, 1st, 3rd; x, width, pedestal top, avatar radius, colors (top, bottom, text)
const PODIUM = [
    { place: 2, x: 56, w: 257, top: 960, r: 76, col: ['#ff9a3c', '#ff6a00', '#ff6a00'], medal: '🥈' },
    { place: 1, x: 337, w: 406, top: 880, r: 88, col: ['#ff5f7e', '#ff2d55', '#ff2d55'], medal: '🥇' },
    { place: 3, x: 767, w: 257, top: 1005, r: 76, col: ['#ffd84a', '#e0a800', '#ffb800'], medal: '🥉' },
];
const BOTTOM = 1150;
const ini = (n) => (n.match(/[A-Za-zА-Яа-яЁё0-9]/g) || [n[0] || '?']).slice(0, 2).join('').toUpperCase();
const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
// a word for a count, forms "one|few|many" (ru: победа|победы|побед, en: win|wins|wins), by the language's rules
const plural = (lang, n, forms) => {
    const [one, few = one, many = few] = forms.split('|');
    const k = new Intl.PluralRules(lang).select(n);
    return k === 'one' ? one : k === 'few' ? few : many;
};

/** the podium: up to three places by wins; players with equal wins share a place (who got there first goes first) */
export function podium(m) {
    const n = {}, at = {};
    for (const w of m.wins) { n[w.key] = (n[w.key] || 0) + 1; at[w.key] = w.t; }
    const places = [];
    for (const key of Object.keys(n).sort((a, b) => n[b] - n[a] || at[a] - at[b])) {
        const pl = { key, wins: n[key], name: m.people[key].name }, last = places[places.length - 1];
        if (last && last.wins === pl.wins) last.players.push(pl);
        else if (places.length < 3) places.push({ wins: pl.wins, players: [pl] });
        else break;
    }
    return places;
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

    // header: the title (small) and the date, then the game (large: it comes first, by look and by sense)
    ctx.font = black(36); ctx.fillStyle = CYAN; ctx.textAlign = 'left';
    spaced(L.title, 58, 70, 7);
    if (m.date) {
        ctx.font = black(36);
        const w = ctx.measureText(m.date).width + 64;
        ctx.fillStyle = PINK; ctx.beginPath(); ctx.roundRect(1024 - w, 36, w, 68, 34); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(m.date, 1024 - w / 2, 71);
    }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    fit(L.game, black, 130, W - 100);
    ctx.fillText(L.game, 50, 186);
    ctx.font = black(44); ctx.fillStyle = CYAN;
    spaced(L.subtitle, 50, 282, 14);

    // the hardest words as tilted stickers, as many as fit in one row
    const words = hardWords(m).map((w) => w.toUpperCase());
    let px = 32;
    const width = (ws) => ws.reduce((a, w) => { ctx.font = black(px); return a + ctx.measureText(w).width + 56; }, 0) + (ws.length - 1) * 18;
    while (words.length && width(words) > W - 100) { if (px > 26) px--; else words.pop(); }
    let x = 50;
    words.forEach((w, i) => {
        ctx.font = black(px);
        const bw = ctx.measureText(w).width + 56, [bg, a] = CHIPS[i];
        ctx.save(); ctx.translate(x + bw / 2, 366); ctx.rotate((a * Math.PI) / 180);
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
        ctx.fillStyle = 'rgba(40,10,10,.75)'; ctx.font = black(p.place === 1 ? 66 : 60); ctx.textAlign = 'center';
        ctx.fillText(String(p.place), p.x + p.w / 2, p.top + 58);
        if (who) drawPlace(ctx, m, p, who, plural(L.lang, who.wins, L.wins), avatars);
    }

    // the stream's totals
    const stats = [
        [m.rounds.length, plural(L.lang, m.rounds.length, L.rounds)], [hm(m.stream), L.stream],
        [m.balloons.length, plural(L.lang, m.balloons.length, L.balloons)], [m.planes.length, plural(L.lang, m.planes.length, L.planes)],
    ];
    stats.forEach(([v, label], i) => {
        label = label.toUpperCase();
        const tx = 56 + i * 247, tw = 227;
        ctx.fillStyle = TILE; ctx.beginPath(); ctx.roundRect(tx, 1180, tw, 124, 24); ctx.fill();
        ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        fit(String(v), black, 52, tw - 30); ctx.fillText(String(v), tx + tw / 2, 1228);
        ctx.fillStyle = '#b9a6e0'; fit(label, black, 24, tw - 24);
        ctx.fillText(label, tx + tw / 2, 1274);
    });

    // the streamer
    ctx.textAlign = 'center';
    if (handle) { ctx.fillStyle = '#fff'; ctx.font = bold(42); ctx.fillText(handle, W / 2, 1350); }
    if (L.footer) { ctx.fillStyle = '#9a9a9a'; fit(L.footer, (p) => `${p}px Arial, sans-serif`, 30, W - 100); ctx.fillText(L.footer, W / 2, 1398); }
}

const AV_MIN = 34, TOP = 430; // the smallest avatar radius; nothing of a place goes above TOP (the word stickers)

// one place from its pedestal up: "N побед", the names (one under another), the medal, the avatars side by side
function drawPlace(ctx, m, p, place, word, avatars) {
    const cx = p.x + p.w / 2, k = place.players.length, row = p.w + 24;
    let y = p.top - 44;
    ctx.textAlign = 'left';
    ctx.font = black(50); const nw = ctx.measureText(String(place.wins)).width;
    ctx.font = bold(30); const ww = ctx.measureText(word).width;
    const sx = cx - (nw + 18 + ww) / 2;
    ctx.fillStyle = p.col[2];
    ctx.font = black(50); ctx.fillText(String(place.wins), sx, y);
    ctx.font = bold(30); ctx.fillText(word, sx + nw + 18, y + 5);

    // avatars: as large as fit in one row over the pedestal; too many = the first ones and "+N"
    let r = Math.min(p.r, Math.floor((row / k - 16) / 2)), shown = k;
    if (r < AV_MIN) { r = AV_MIN; shown = Math.max(1, Math.floor(row / (2 * r + 16)) - 1); }
    // names: one player = up to two lines; several = one line each, the list shrinking to the room left
    // gaps: under the names (to "N побед") and over them (to the medal) follow the line height
    let lines, lh = 48, below = 60, above = 72;
    if (k === 1) lines = nameLines(ctx, place.players[0].name, row);
    else {
        let px = 36, names = place.players.map((pl) => pl.name);
        const roomAt = (h) => y - (30 + h / 2) - (40 + h / 2) - 48 - 2 * r - 6 - TOP + h;
        while (px > 22 && names.length * Math.round(px * 1.2) > roomAt(Math.round(px * 1.2))) px -= 2;
        lh = Math.round(px * 1.2); below = 30 + lh / 2; above = 40 + lh / 2;
        const room = roomAt(lh);
        const fits = Math.max(1, Math.floor(room / lh));
        if (names.length > fits) names = [...names.slice(0, fits - 1), `+${names.length - fits + 1}`];
        ctx.font = bold(px);
        lines = Object.assign(names.map((nm) => cut(ctx, nm, p.w + 16)), { size: px });
    }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    y -= below + (lines.length - 1) * lh;
    lines.forEach((ln, i) => { ctx.font = bold(lines.size); ctx.fillText(ln, cx, y + i * lh); });
    y -= above;
    ctx.font = `56px ${EMOJI}`; ctx.fillText(p.medal, cx, y);
    const ay = y - 48 - r, n = shown < k ? shown + 1 : k, step = Math.min(2 * r + 16, row / n);
    for (let i = 0; i < n; i++) {
        const ax = cx + (i - (n - 1) / 2) * step;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ax, ay, r + 6, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = p.col[1]; ctx.beginPath(); ctx.arc(ax, ay, r, 0, 2 * Math.PI); ctx.fill();
        const who = place.players[i], img = i < shown && avatars.get(m.people[who.key]?.avatar);
        if (img) {
            ctx.save(); ctx.clip(); ctx.drawImage(img, ax - r, ay - r, 2 * r, 2 * r); ctx.restore();
        } else {
            ctx.fillStyle = '#fff'; ctx.font = black(Math.round(r * (i < shown ? 0.75 : 0.6)));
            ctx.fillText(i < shown ? ini(who.name) : `+${k - shown}`, ax, ay + 4);
        }
    }
}

// a name cut with "…" to the width (the current font)
function cut(ctx, name, max) {
    let c = name;
    while (c.length > 1 && ctx.measureText(c + '…').width > max) c = c.slice(0, -1);
    return c === name ? name : c + '…';
}

// a name in at most two lines of the width, the font shrinking until it fits; lines.size = the font's px
function nameLines(ctx, name, max) {
    const words = name.trim().split(/\s+/);
    for (let px = 44; px >= 24; px -= 2) {
        ctx.font = bold(px);
        if (ctx.measureText(name).width <= max && (words.length < 2 || px >= 40)) return Object.assign([name], { size: px });
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
