// End to end on a developer machine: the hard-round clip built by the site's own modules (resources/js/Pages/Guessword/Clip)
// in headless Chrome, from a local HLS cut that stands in for LIVE Center (tests/clip/runner.html plays the extension).
//   node tests/clip/e2e.mjs <hls dir with index.m3u8 and segments> <speech.json> <out dir> <t0> <t1> <liveStart> [word] [winner]
// The m3u8 must carry #EXT-X-PROGRAM-DATE-TIME (see tiktok-clips/tools/hls-cut.js). t0/t1 = the round's start / end in the
// LIVE log's seconds, liveStart = unix time of the log's second 0. Not in CI (needs Chrome, a recording, fonts).
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const [hlsDir, speechFile, outDir, t0, t1, liveStart, word = 'ФУНКЦИОНИРОВАНИЕ', winner = 'Нина 🇲🇩🇦🇿'] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
const pages = path.join(repo, 'resources/js/Pages/Guessword');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t' };

const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = null;
    if (p === '/runner.html') f = path.join(here, 'runner.html');
    else if (p === '/mediabunny.mjs') f = path.join(repo, 'node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    else if (p.startsWith('/g/') && !p.includes('..')) f = path.join(pages, p.slice(3));
    else if (p.startsWith('/hls/') && !p.includes('..')) f = path.join(hlsDir, p.slice(5));
    if (!f || !existsSync(f)) { res.writeHead(404).end(); return; }
    const size = statSync(f).size, m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const type = TYPES[path.extname(f)] || 'application/octet-stream';
    if (m) {
        const a = Number(m[1]), b = Math.min(size - 1, m[2] ? Number(m[2]) : size - 1);
        res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': b - a + 1 });
        createReadStream(f, { start: a, end: b }).pipe(res);
    } else {
        res.writeHead(200, { 'content-type': type, 'content-length': size });
        createReadStream(f).pipe(res);
    }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;

const speech = JSON.parse(readFileSync(speechFile, 'utf8'));
const words = (Array.isArray(speech) ? speech[0] : speech).words;
const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, userDataDir: mkdtempSync(path.join(tmpdir(), 'clip-e2e-')), args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
    const page = await browser.newPage();
    page.on('console', (m) => console.log('[page]', m.text()));
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`${base}/runner.html`);
    await page.waitForFunction('window.ready === true', { timeout: 30000 });
    const t = Date.now();
    const r = await page.evaluate((d) => window.run(d), {
        m3u8: `${base}/hls/index.m3u8`, liveStart: Number(liveStart), t0: Number(t0), t1: Number(t1), words, word, winner, hook: '15 МИНУТ НА ОДНО СЛОВО',
    });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'clip.mp4'), Buffer.from(r.video, 'base64'));
    writeFileSync(path.join(outDir, 'cover.png'), Buffer.from(r.cover, 'base64'));
    console.log(r.log.join('\n'));
    console.log(`built in ${((Date.now() - t) / 1000).toFixed(0)} s -> ${outDir}`);
} finally {
    await browser.close();
    server.close();
}
