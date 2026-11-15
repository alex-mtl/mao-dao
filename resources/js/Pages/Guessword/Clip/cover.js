// "Hard round" clip, part 4 of 4: the TikTok cover (1080x1440, 3:4: what TikTok keeps of a cover). The top ten rows of the
// game's table are cut from a real frame shortly before the win, so the colors, avatars and nicknames are exactly what the
// viewers saw; above them "chat failed / can you guess?", below the length of the round. The word itself stays hidden.
import { keyPictures, TABLE } from './build.js';
import { BRAND } from './draw.js';

export const CW = 1080, CH = 1440;
const FONT = (px) => `900 ${px}px "Arial Black", "Segoe UI Emoji", "Noto Color Emoji", Arial, sans-serif`;

/** the frame `before` seconds before the win (LIVE s t1) -> the cover canvas */
export async function buildCover({ src, t1, before = 30, labels, date, username }) {
    let frame = null;
    for await (const pic of keyPictures(src, [t1 - before])) frame = pic;
    const cv = new OffscreenCanvas(CW, CH), ctx = cv.getContext('2d');
    ctx.fillStyle = '#0a0019';
    ctx.fillRect(0, 0, CW, CH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const line = (text, y, px, color) => { ctx.font = FONT(px); ctx.fillStyle = color; ctx.fillText(text, CW / 2, y, 1000); };
    line(`${labels.game} · ${date}`, 84, 34, BRAND.cyan);
    line(labels.title1, 195, 64, BRAND.pink);
    line(labels.title2, 355, 112, BRAND.green);
    // the table: 10 rows of the frame, scaled to 1000 px wide, in a frame like the game's
    const x = 40, y = 470, w = 1000;
    ctx.fillStyle = '#05001a';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 694, 26);
    ctx.fill();
    if (frame) {
        const fw = frame.width, fh = frame.height, sw = fw * TABLE.w, sh = fh * TABLE.row * 10 + fh * 0.003, k = (w - 6) / sw;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x + 3, y + 3, w - 6, 688, 24);
        ctx.clip();
        ctx.drawImage(frame, fw * TABLE.x, fh * TABLE.y - fh * 0.003, sw, sh, x + 3, y + 3, w - 6, sh * k);
        ctx.restore();
    }
    ctx.strokeStyle = '#7a3cff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 694, 26);
    ctx.stroke();
    line(labels.caption, 1245, 34, '#a99bd0');
    line('@' + String(username || '').toUpperCase(), 1370, 34, BRAND.cyan);
    return cv;
}
