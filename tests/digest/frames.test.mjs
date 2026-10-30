// The digest's overlay (resources/js/Pages/Guessword/Digest) against reference frames: one events.json
// (synthetic nicks, the shape of tiktok-clips' events), several clip moments, pixels compared.
// Runs on a developer machine with Chrome (not in CI: fonts differ between systems):
//   node tests/digest/frames.test.mjs            compare with tests/digest/ref/*.png
//   node tests/digest/frames.test.mjs --update   after an intended change of the look: new references
// CHROME = path to chrome.exe (default: the usual Windows install).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from '../../resources/js/Pages/Guessword/Digest/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOMENTS = [0.5, 7.3, 12.02, 25, 33.3, 47.7, 59.9];
const STREAM = 26864;             // stream seconds of the events (a 7.5 h LIVE)
const LIMIT = 0.2;                // % of pixels allowed to differ (antialiasing)
const update = process.argv.includes('--update');

const events = JSON.parse(readFileSync(path.join(here, 'events.json'), 'utf8'));
const server = await serve();
const profile = mkdtempSync(path.join(tmpdir(), 'digest-test-'));
const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, userDataDir: profile,
});
let failed = 0;
try {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.waitForFunction('window.ready === true');
    const frames = await page.evaluate((d, vs) => window.renderFrames(d, vs), { events, duration: STREAM, date: '2026-10-19' }, MOMENTS);
    mkdirSync(path.join(here, 'ref'), { recursive: true });
    for (let i = 0; i < MOMENTS.length; i++) {
        const ref = path.join(here, 'ref', `${MOMENTS[i]}.png`);
        if (update) {
            writeFileSync(ref, Buffer.from(frames[i].split(',')[1], 'base64'));
            continue;
        }
        const pct = await page.evaluate(async (a, b) => {
            const load = (u) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
            const [A, B] = await Promise.all([load(a), load(b)]);
            const c = new OffscreenCanvas(1080, 1920), x = c.getContext('2d');
            x.drawImage(A, 0, 0); const da = x.getImageData(0, 0, 1080, 1920).data;
            x.clearRect(0, 0, 1080, 1920);
            x.drawImage(B, 0, 0); const db = x.getImageData(0, 0, 1080, 1920).data;
            let diff = 0;
            for (let p = 0; p < da.length; p += 4) {
                let m = Math.abs(da[p + 3] - db[p + 3]);
                for (let c2 = 0; c2 < 3; c2++) m = Math.max(m, Math.abs(da[p + c2] * da[p + 3] - db[p + c2] * db[p + 3]) / 255);
                if (m > 48) diff++;
            }
            return (100 * diff) / (1080 * 1920);
        }, 'data:image/png;base64,' + readFileSync(ref).toString('base64'), frames[i]);
        const ok = pct <= LIMIT;
        if (!ok) failed++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} v=${MOMENTS[i]}s: ${pct.toFixed(3)}% pixels differ`);
    }
    if (update) console.log(`${MOMENTS.length} reference frames written to tests/digest/ref/`);
} finally {
    await browser.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
