// "Hard round" clip, part 3 of 4: the video, built in the streamer's Chrome straight from TikTok LIVE Center
// (browser extension; the same reading as the digests: ../Digest/livecenter.js). Nothing is downloaded whole:
//   time-lapse = the key frame each ~4 s segment starts with (keyPictures);
//   remarks and the finale = their segments decoded frame by frame (../Digest/build.js hlsDense) with their sound.
// The table's pixels tell where the round stopped moving (detectStall); the cover is cut from a real frame (cover.js).
import { AudioSample, AudioSampleSource, BufferTarget, CanvasSource, canEncodeAudio, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny';
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { hlsDense } from '../Digest/build.js';
import { FADE, keyDecoder, PREFETCH, RATE, stretchSound, timeout } from '../DevDigest/build.js';
import { keyFrame } from '../Digest/livecenter.js';
import { audioFrames } from '../Digest/ts.js';
import { drawPicture, H, overlay, W } from './draw.js';
import { FPS, stallFrom, subtitleChunks } from './plan.js';

/** where the table is on the frame, as fractions of its size (the game's overlay on a 9:16 recording) */
export const TABLE = { x: 0.128, w: 0.761, y: 0.3375, row: 37.6 / 1280 };

const segmentOf = (segs, wall) => { let lo = 0, hi = segs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].at <= wall) lo = m; else hi = m - 1; } return lo; };

// A recording is a source `src`: {hls, liveStart} (TikTok LIVE Center; liveStart = unix time of the LIVE log's second 0)
// or {file} (a local MP4 of the recording; its second t is the LIVE second t). Times below are LIVE seconds.

/** a local MP4: one picture (a canvas of the file's own size, or null) per time of `ts` (ascending), every frame decoded from its key frame */
async function* filePictures(file, ts) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new VideoSampleSink(track);
    for await (const s of sink.samplesAtTimestamps(ts)) {
        if (!s) { yield null; continue; }
        const c = new OffscreenCanvas(track.displayWidth, track.displayHeight);
        s.draw(c.getContext('2d'), 0, 0, c.width, c.height);
        s.close();
        yield c;
    }
}

/** the sound of a local MP4 from `from` for `len` s: [left, right] at RATE, faded in and out (like stretchSound), or null */
async function fileSound(file, from, len) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const n = Math.round(len * RATE), L = new Float32Array(n), R = new Float32Array(n);
    for await (const a of new AudioSampleSink(track).samples(from, from + len)) {
        const ch = a.numberOfChannels, fr = a.numberOfFrames, src = [];
        for (let k = 0; k < Math.min(ch, 2); k++) { const buf = new Float32Array(fr); a.copyTo(buf, { planeIndex: k, format: 'f32-planar' }); src.push(buf); }
        if (src.length === 1) src.push(src[0]);
        const t0 = a.timestamp - from, rate = a.sampleRate, o0 = Math.max(0, Math.ceil(t0 * RATE)), o1 = Math.min(n, Math.floor((t0 + fr / rate) * RATE));
        for (let o = o0; o < o1; o++) {
            const x = (o / RATE - t0) * rate, i = Math.floor(x), f = x - i, j = Math.min(fr - 1, i + 1);
            if (i < 0 || i >= fr) continue;
            L[o] = src[0][i] * (1 - f) + src[0][j] * f;
            R[o] = src[1][i] * (1 - f) + src[1][j] * f;
        }
        a.close();
    }
    const fade = Math.round(FADE * RATE);
    for (let o = 0; o < Math.min(fade, n); o++) { const g = o / fade; L[o] *= g; R[o] *= g; L[n - 1 - o] *= g; R[n - 1 - o] *= g; }
    return [L, R];
}

/**
 * One picture per wall-clock second of `walls` (unix s, any order within reason): the key frame of the segment that
 * covers it, segments read PREFETCH ahead. A segment that fails to load keeps the previous picture.
 */
export async function* keyPictures(src, ts) {
    if (src.file) { yield* filePictures(src.file, ts); return; }
    const { hls } = src, walls = ts.map((t) => src.liveStart + t);
    const segs = hls.segments, seg = walls.map((w) => segmentOf(segs, w)), order = [...new Set(seg)], cache = new Map();
    const decode = keyDecoder();
    const load = (k) => { if (k >= 0 && k < order.length && !cache.has(order[k])) cache.set(order[k], timeout(keyFrame(segs[order[k]].url), 60000)); };
    let shown = -1, still = null;
    for (let i = 0; i < walls.length; i++) {
        if (seg[i] !== shown) {
            const k = order.indexOf(seg[i]);
            for (let j = k; j < k + PREFETCH; j++) load(j);
            const kf = await cache.get(seg[i]);
            cache.delete(seg[i]);
            if (kf) { const pic = await decode(kf); if (pic) still = pic; }
            shown = seg[i];
        }
        yield still;
    }
}

// the top five rows of the table as a 64 x 32 grey thumbnail
function thumb(pic, cx) {
    const w = pic.width, h = pic.height;
    cx.drawImage(pic, w * TABLE.x, h * TABLE.y, w * TABLE.w, TABLE.row * h * 5, 0, 0, 64, 32);
    const d = cx.getImageData(0, 0, 64, 32).data, g = new Uint8Array(64 * 32);
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
    return g;
}

/**
 * Where the top of the table stops changing, read from the recording: one key frame every STEP s of the round.
 * Returns {stall (LIVE s) | null, samples}. onProgress(done, total).
 */
export async function detectStall(src, t0, t1, onProgress = () => {}, signal) {
    const STEP = 6, n = Math.max(2, Math.floor((t1 - t0) / STEP));
    const walls = Array.from({ length: n }, (_, i) => t0 + i * STEP);
    const cx = new OffscreenCanvas(64, 32).getContext('2d', { willReadFrequently: true });
    const diffs = [];
    let prev = null, i = 0;
    for await (const pic of keyPictures(src, walls)) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (pic) {
            const g = thumb(pic, cx);
            if (prev) { let d = 0; for (let j = 0; j < g.length; j++) d += Math.abs(g[j] - prev[j]); diffs.push(d / g.length); }
            prev = g;
        }
        onProgress(++i, n);
    }
    return { stall: stallFrom(diffs, STEP, t0, t1 - t0), samples: diffs.length };
}

// ---- sounds, synthesized (the same as the ffmpeg version): added to the clip's master track ----
function mix(L, R, at, len, f, gain = 1) {
    const o = Math.round(at * RATE);
    for (let i = 0; i < len * RATE; i++) {
        const k = o + i;
        if (k < 0 || k >= L.length) continue;
        const v = f(i / RATE) * gain;
        L[k] += v;
        R[k] += v;
    }
}
const tada = (t) => (0.4 * (Math.sin(2 * Math.PI * 523 * t) + Math.sin(2 * Math.PI * 659 * t)) * (t < 0.16 ? 1 : 0) * Math.exp(-4 * t)
    + 0.35 * (Math.sin(2 * Math.PI * 784 * t) + Math.sin(2 * Math.PI * 988 * t) + Math.sin(2 * Math.PI * 1319 * t)) * (t >= 0.18 ? 1 : 0) * Math.exp(-2.5 * (t - 0.18)));
const whoosh = (t) => (Math.random() * 2 - 1) * 0.35 * Math.min(1, t / 0.2) * Math.min(1, (0.5 - t) / 0.25);
const tick = (t) => 0.25 * Math.sin(2 * Math.PI * 1900 * t) * (t % 0.25 < 0.02 ? 1 : 0);

/**
 * Build the clip. src = {hls (playlist() of livecenter.js), liveStart (unix time of the LIVE log's second 0)} or {file}; plan = plan();
 * words = the host's words; opts: {round: {word, winner, avatar}, hook, labels, signal, canvas, bitrate, onProgress({frame, frames, stage})}.
 * Returns {blob, seconds} (video/mp4 with sound).
 */
export async function buildClip({ src, plan, words, round, hook, labels, signal, canvas, bitrate = 8e6, onProgress = () => {} }) {
    const frames = Math.round(plan.total * FPS), cv = canvas || new OffscreenCanvas(W, H), ctx = cv.getContext('2d');
    const L = new Float32Array(Math.ceil(plan.total * RATE) + RATE), R = new Float32Array(L.length);
    const audioCodec = (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: RATE })) ? 'aac' : 'opus';
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const video = new CanvasSource(cv, { codec: 'avc', bitrate, keyFrameInterval: 2 });
    const audio = new AudioSampleSource({ codec: audioCodec, quality: QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: FPS });
    output.addAudioTrack(audio);
    await output.start();

    const t1 = plan.segs.find((s) => s.kind === 'freeze')?.at ?? -1e9, plateData = round && { word: round.word, winner: round.winner, avatar: round.avatar, guessedBy: labels.guessedBy };
    // zoom on the host's face from 3 s before the win to 2 s after, eased in and out
    const zoomAt = (stream) => { const a = Math.min(1, Math.max(0, (stream - (t1 - 3)) / 0.6)), b = Math.min(1, Math.max(0, (t1 + 2 - stream) / 0.6)); return 1 + 0.25 * Math.min(a, b); };
    let n = 0, last = null;
    const put = async (pic, seg, k, stream) => {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const clipT = n / FPS;
        drawPicture(ctx, pic, seg.zoom || seg.kind === 'freeze' ? zoomAt(stream) : 1);
        const st = { t: clipT, total: plan.total, hook, labels, stream, ff: null, chunk: null, plate: null };
        if (seg.kind === 'ff') st.ff = { rate: Math.round((seg.to - seg.from) / (seg.frames / FPS)), skipped: (seg.to - seg.from) * (k / seg.frames) };
        if (seg.kind === 'dense') st.chunk = seg.chunks.find((c) => stream >= c.from - 0.05 && stream <= c.to + 0.3) || null;
        if (seg.kind === 'freeze') st.plate = plateData;
        overlay(ctx, st);
        await video.add(n / FPS, 1 / FPS);
        n++;
        if (n % 15 === 0) onProgress({ frame: n, frames, stage: 'frames' });
    };

    try {
        for (const seg of plan.segs) {
            if (seg.kind === 'ff') {
                const walls = Array.from({ length: seg.frames }, (_, k) => seg.from + ((seg.to - seg.from) * k) / seg.frames);
                mix(L, R, seg.out0, 0.5, whoosh);
                mix(L, R, seg.out0, seg.dur, tick);
                let k = 0;
                for await (const pic of keyPictures(src, walls)) { last = pic || last; await put(last, seg, k, seg.from + ((seg.to - seg.from) * k) / seg.frames); k++; }
            } else if (seg.kind === 'freeze') {
                mix(L, R, seg.out0, 1.4, tada);
                for (let k = 0; k < Math.round(seg.dur * FPS); k++) await put(last, seg, k, seg.at);
            } else {
                const nf = Math.round(seg.dur * FPS), ts = Array.from({ length: nf }, (_, k) => seg.from + k / FPS), chunks = [];
                seg.chunks = subtitleChunks(words, seg.from, seg.to);
                if (src.file) {
                    let k = 0;
                    for await (const pic of filePictures(src.file, ts)) { last = pic || last; await put(last, seg, k, ts[k]); k++; }
                    const pcm = await fileSound(src.file, ts[0], nf / FPS);
                    if (pcm) for (let i = 0; i < pcm[0].length; i++) { const o = Math.round(seg.out0 * RATE) + i; if (o < L.length) { L[o] += pcm[0][i]; R[o] += pcm[1][i]; } }
                    continue;
                }
                const onSegment = (b, clock, pts0) => {
                    const a = audioFrames(b);
                    if (!a) return;
                    chunks.config ||= a;
                    for (const x of a.frames) chunks.push({ wall: clock + (x.pts - pts0), data: x.data });
                };
                const walls = ts.map((t) => src.liveStart + t), reader = hlsDense(src.hls, walls, 0, onSegment);
                for (let k = 0; k < nf; k++) {
                    const { value } = await reader.next();
                    if (value) last = value;
                    await put(last, seg, k, ts[k]);
                }
                await reader.return?.();
                const pcm = await stretchSound(chunks.filter((c) => c.wall >= walls[0] - 0.1 && c.wall <= walls[nf - 1] + 0.2), chunks.config, walls[0], nf / FPS);
                if (pcm) for (let i = 0; i < pcm[0].length; i++) { const o = Math.round(seg.out0 * RATE) + i; if (o < L.length) { L[o] += pcm[0][i]; R[o] += pcm[1][i]; } }
            }
        }
        // the master track: clipped to [-1, 1], planar stereo
        const len = Math.round(plan.total * RATE), data = new Float32Array(len * 2);
        for (let i = 0; i < len; i++) { data[i] = Math.max(-1, Math.min(1, L[i])); data[len + i] = Math.max(-1, Math.min(1, R[i])); }
        const master = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: RATE, timestamp: 0 });
        await audio.add(master);
        master.close();
        video.close();
        audio.close();
        onProgress({ frame: frames, frames, stage: 'mux' });
        await output.finalize();
    } catch (e) {
        await output.cancel().catch(() => {});
        throw e;
    }
    return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), seconds: plan.total };
}
