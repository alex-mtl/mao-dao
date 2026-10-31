// The streamer's TikTok LIVE Center recordings through the browser extension (browser-extension/, "Mao Dao:
// LIVE Center recordings"): the recording of a LIVE by its TikTok room id, then only the first bytes of the
// HLS segments the digest needs (each ~4 s segment starts with a key frame). Nothing is downloaded whole.
import { codecString, firstVideoFrame } from './ts.js';

let seq = 0;
const pending = new Map();
if (typeof window !== 'undefined') {
    window.addEventListener('message', (e) => {
        if (e.source !== window || e.data?.__maodao !== 'res' || !pending.has(e.data.id)) return;
        const { resolve, reject } = pending.get(e.data.id);
        pending.delete(e.data.id);
        e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error || 'extension error'));
    });
}
function call(op, args = {}) {
    return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        window.postMessage({ __maodao: 'req', id, op, args }, location.origin);
    });
}

/** the installed extension's version, or null */
export const extension = () => document.documentElement.dataset.maodaoLivecenter || null;

/** the LIVE Center recording of a TikTok LIVE: {id, title, start, finish, duration, m3u8} or null */
export const findReplay = (roomId, start) => call('replay', { roomId, start });

/**
 * The recording as a list of segments with their wall-clock start (#EXT-X-PROGRAM-DATE-TIME), which places
 * any second of the LIVE log exactly in the video: {segments: [{url, at (unix s), dur}], start, end}.
 */
export async function playlist(replay) {
    const text = await call('text', { url: replay.m3u8 });
    const segments = [];
    let at = null, dur = 0;
    for (const line of text.split('\n').map((l) => l.trim())) {
        // ISO time; an offset without the colon (-0400, as ffmpeg writes it) made ISO
        if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) at = Date.parse(line.slice(25).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) / 1000;
        else if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8));
        else if (line && !line.startsWith('#')) {
            const prev = segments[segments.length - 1];
            segments.push({ url: new URL(line, replay.m3u8).href, at: at ?? (prev ? prev.at + prev.dur : replay.start), dur });
            at = null;
        }
    }
    if (!segments.length) throw new Error('empty playlist');
    const last = segments[segments.length - 1];
    return { segments, start: segments[0].at, end: last.at + last.dur };
}

// An optional local store of the bytes already read ({get(key) -> Uint8Array | null, put(key, bytes)}): the
// development digest keeps them on disk, so a rerun reads nothing from TikTok's CDN. Key = the segment's
// address without its signature + the byte range (the signed query changes, the segment does not).
let store = null;
export const useStore = (s) => { store = s; };
async function range(url, from, to) {
    const u = new URL(url), key = store && `${u.host}${u.pathname}#${from}-${to}`;
    if (store) {
        const hit = await store.get(key).catch(() => null);
        if (hit) return hit;
    }
    const b = new Uint8Array(await call('range', { url, from, to }));
    if (store) store.put(key, b).catch(() => {});
    return b;
}

/** a whole segment (~4 s, a few MB): for the stretches played slowly, which need every frame */
export async function segment(url) {
    return range(url, 0, 33554431);
}

/** the key frame a segment starts with: {codec (VideoDecoder string), data (Annex B)}; reads 512 KB, more if needed */
export async function keyFrame(url) {
    for (let size = 524288; size <= 8388608; size *= 2) {
        const buf = await range(url, 0, size - 1);
        const f = firstVideoFrame(buf);
        if (f) return { codec: codecString(f.codec, f.data), data: f.data, bytes: buf.length };
        if (buf.length < size) break;           // the whole segment and still no frame
    }
    throw new Error('no video frame in segment');
}
