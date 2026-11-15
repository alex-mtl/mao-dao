// "Hard round" clip, part 2 of 4: the overlay of one 1080x1920 frame on a 2D canvas (brand: docs in tiktok-clips/docs/brand-style.md).
// Text never goes above the waterline y = 640 (the host's camera is the top third). Nicknames are drawn as they are
// written: the font stack falls back to the system's emoji / math symbols, like the digest's.
export const W = 1080, H = 1920;
export const BRAND = { cyan: '#22E5FF', green: '#7CFF4F', pink: '#FF3EA5', dark: '#1A0B2E' };
const FONT = (px) => `900 ${px}px "Arial Black", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", Arial, sans-serif`;
const SUB_Y = 1490, HOOK_Y = 1230, CTA_Y = 1120, FACE_Y = 330;
export const HOOK_S = 3, CTA_S = 2.4;

function outlined(ctx, text, x, y, px, fill, stroke = BRAND.dark, width = px * 0.1) {
    ctx.font = FONT(px);
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
}

function box(ctx, text, y, px, bg, color, pad = 26) {
    ctx.font = FONT(px);
    const w = Math.min(980, ctx.measureText(text).width + pad * 2);
    ctx.fillStyle = bg;
    ctx.fillRect((W - w) / 2, y - px * 0.62 - pad * 0.5, w, px * 1.24 + pad);
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, y, 980 - pad * 2);
}

/** the hook (first seconds): a pink plate, long text in two balanced lines */
function hook(ctx, text) {
    const ws = text.toUpperCase().split(/\s+/);
    let lines = [ws.join(' ')];
    if (lines[0].length > 18 && ws.length > 1) {
        let best = 1, cost = Infinity;
        for (let i = 1; i < ws.length; i++) { const c = Math.max(ws.slice(0, i).join(' ').length, ws.slice(i).join(' ').length); if (c < cost) { cost = c; best = i; } }
        lines = [ws.slice(0, best).join(' '), ws.slice(best).join(' ')];
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => box(ctx, l, HOOK_Y + (i - (lines.length - 1) / 2) * 90, 66, BRAND.pink, '#fff', 22));
}

/** a subtitle chunk (subtitleChunks()): the word being said is green and a little bigger */
function subtitle(ctx, chunk, t) {
    const words = chunk.words;
    let now = words.findIndex((w) => t >= w.s && t < w.e);
    if (now < 0) now = Math.max(0, words.findIndex((w) => w.s > t) - 1);
    if (now < 0) now = words.length - 1;
    const lines = [words.slice(0, chunk.split), words.slice(chunk.split)].filter((l) => l.length);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((line, li) => {
        const y = SUB_Y + (li - (lines.length - 1) / 2) * 84;
        ctx.font = FONT(72);
        const gap = ctx.measureText(' ').width, widths = line.map((w) => ctx.measureText(w.t).width);
        let x = (W - (widths.reduce((a, b) => a + b, 0) + gap * (line.length - 1))) / 2;
        line.forEach((w, i) => {
            const cur = words.indexOf(w) === now;
            outlined(ctx, w.t, x, y, cur ? 79 : 72, cur ? BRAND.green : '#fff', BRAND.dark, 7);
            x += widths[i] + gap;
        });
    });
}

/** the stop frame on the win: the word, who guessed it (avatar and the nickname as written) */
function plate(ctx, { word, winner, avatar, guessedBy }) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = FONT(84);
    const ww = Math.min(980, ctx.measureText(word.toUpperCase()).width + 80);
    const h = winner ? 250 : 140, top = 960;
    ctx.fillStyle = 'rgba(255,62,165,.92)';
    ctx.beginPath();
    ctx.roundRect((W - Math.max(ww, winner ? 760 : 0)) / 2, top, Math.max(ww, winner ? 760 : 0), h, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = FONT(84);
    ctx.fillText(word.toUpperCase(), W / 2, top + 70, 900);
    if (winner) {
        ctx.font = FONT(44);
        const label = `${guessedBy}: `, lw = ctx.measureText(label).width;
        const nick = winner.length > 24 ? winner.slice(0, 23) + '…' : winner;
        const nw = ctx.measureText(nick).width, total = 80 + lw + nw, x0 = (W - total) / 2;
        if (avatar) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x0 + 32, top + 175, 32, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(avatar, x0, top + 143, 64, 64);
            ctx.restore();
        }
        ctx.textAlign = 'left';
        ctx.fillText(label + nick, x0 + 80, top + 176);
    }
}

/**
 * overlay(ctx, s): s = { t (clip s), total, hook (text), ff: {rate, skipped (stream s)} | null, chunk, t (stream s of the
 * 1x picture), plate: {...} | null, labels: {rewind, cta1, cta2} }. Called after the picture is drawn.
 */
export function overlay(ctx, s) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (s.ff) {
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.fillRect(0, 0, W, H);
        outlined(ctx, `${s.labels.rewind} x${s.ff.rate}`, W / 2, 820, 64, BRAND.cyan, BRAND.dark, 6);
        const k = Math.round(s.ff.skipped);
        outlined(ctx, `+${Math.floor(k / 60)}:${String(k % 60).padStart(2, '0')}`, W / 2, 940, 150, '#fff', BRAND.dark, 8);
    }
    if (s.chunk) subtitle(ctx, s.chunk, s.stream);
    if (s.plate) plate(ctx, s.plate);
    if (s.t < HOOK_S && s.hook) {
        ctx.globalAlpha = Math.min(1, (HOOK_S - s.t) / 0.4);
        hook(ctx, s.hook);
        ctx.globalAlpha = 1;
    }
    ctx.fillStyle = BRAND.cyan;
    ctx.fillRect(0, 0, (W * s.t) / s.total, 12);
    if (s.t >= s.total - CTA_S) {
        ctx.textAlign = 'center';
        box(ctx, s.labels.cta1, CTA_Y, 70, BRAND.green, BRAND.dark, 26);
        outlined(ctx, s.labels.cta2, W / 2, CTA_Y + 120, 52, '#fff', BRAND.dark, 5);
    }
    ctx.restore();
}

/** the picture under the overlay, cover-fitted to the frame; zoom 1..1.3 around the host's face */
export function drawPicture(ctx, img, zoom = 1) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!img) return;
    const w = img.displayWidth || img.width, h = img.displayHeight || img.height, k = Math.max(W / w, H / h);
    ctx.save();
    if (zoom !== 1) {
        ctx.translate(W / 2, FACE_Y);
        ctx.scale(zoom, zoom);
        ctx.translate(-W / 2, -FACE_Y);
    }
    ctx.drawImage(img, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
    ctx.restore();
}
