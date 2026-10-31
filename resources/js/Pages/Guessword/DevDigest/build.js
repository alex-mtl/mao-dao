// Development digest, part 3 of 3: the video, built in the streamer's Chrome straight from TikTok LIVE Center
// (browser extension, the same reading as the "champion race" digest: ../Digest/livecenter.js). Nothing is
// downloaded whole: timelapse = the key frame each ~4 s segment starts with; the new animations = their
// segments decoded frame by frame (../Digest/build.js hlsDense), with their sound (AAC from the same segments).
// Elsewhere the sound track is silence.
import { AudioSample, AudioSampleSource, BufferTarget, CanvasSource, canEncodeAudio, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget } from 'mediabunny';
import { hlsDense } from '../Digest/build.js';
import { findReplay, keyFrame, playlist } from '../Digest/livecenter.js';
import { audioFrames } from '../Digest/ts.js';
import { renderer, W, H } from './draw.js';
import { FPS, schedule } from './schedule.js';

const RATE = 48000, FADE = 0.25, PREFETCH = 48;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the LIVE Center recordings the plan needs: {id: hls (playlist()) | null}; onStatus(id, found) per recording */
export async function recordings(data, ids, onStatus = () => {}) {
    const out = {};
    for (const id of ids) {
        const s = data.streams[id];
        let hls = null;
        try {
            const r = await findReplay(s.room || '', s.start);
            if (r?.m3u8) hls = await playlist(r);
        } catch { /* not found: the recording's stretches stay black */ }
        out[id] = hls;
        onStatus(id, !!hls);
    }
    return out;
}

// picture (cover) on the canvas
function cover(ctx, img) {
    const w = img.displayWidth || img.width, h = img.displayHeight || img.height;
    const k = Math.max(W / w, H / h);
    ctx.drawImage(img, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
}

// one key frame at a time: decode, wait for it, copy it to a canvas (a held VideoFrame would stall the decoder)
function keyDecoder() {
    let dec = null, codec = null, wait = null;
    return async (kf) => {
        if (!dec || dec.state === 'closed' || codec !== kf.codec) {
            try { dec?.close(); } catch { /* closed */ }
            dec = new VideoDecoder({ output: (f) => (wait ? wait(f) : f.close()), error: () => { dec = null; } });
            dec.configure({ codec: kf.codec });
            codec = kf.codec;
        }
        const got = new Promise((r) => { wait = r; });
        try {
            dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: 0, data: kf.data }));
            await dec.flush();
        } catch { dec = null; }
        const f = await Promise.race([got, sleep(3000).then(() => null)]);
        wait = null;
        if (!f) return null;
        const c = new OffscreenCanvas(f.displayWidth, f.displayHeight);
        c.getContext('2d').drawImage(f, 0, 0);
        f.close();
        return c;
    };
}

// the sound of a 1x stretch: AAC frames {wall, data} decoded and laid on its own timeline (from wall0, len s),
// resampled to RATE, stereo, faded in and out. Returns [left, right] Float32Arrays or null.
async function stretchSound(chunks, config, wall0, len) {
    if (!chunks.length || !config) return null;
    const n = Math.round(len * RATE), L = new Float32Array(n), R = new Float32Array(n);
    const datas = [];
    const dec = new AudioDecoder({ output: (a) => datas.push(a), error: () => {} });
    try {
        dec.configure({ codec: 'mp4a.40.2', sampleRate: config.sampleRate, numberOfChannels: config.channels, description: config.description });
        for (const c of chunks) dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((c.wall - wall0) * 1e6), data: c.data }));
        await dec.flush();
    } catch { /* what was decoded stays */ }
    try { dec.close(); } catch { /* closed */ }
    for (const a of datas) {
        const ch = a.numberOfChannels, fr = a.numberOfFrames, src = [];
        for (let k = 0; k < Math.min(ch, 2); k++) {
            const buf = new Float32Array(fr);
            a.copyTo(buf, { planeIndex: k, format: 'f32-planar' });
            src.push(buf);
        }
        if (src.length === 1) src.push(src[0]);
        const t0 = a.timestamp / 1e6;
        const from = Math.max(0, Math.ceil(t0 * RATE)), to = Math.min(n, Math.floor((t0 + fr / a.sampleRate) * RATE));
        for (let o = from; o < to; o++) {
            const x = (o / RATE - t0) * a.sampleRate, i = Math.floor(x), f = x - i;
            if (i < 0 || i >= fr) continue;
            const j = Math.min(fr - 1, i + 1);
            L[o] = src[0][i] * (1 - f) + src[0][j] * f;
            R[o] = src[1][i] * (1 - f) + src[1][j] * f;
        }
        a.close();
    }
    const fade = Math.round(FADE * RATE);
    for (let o = 0; o < Math.min(fade, n); o++) { const g = o / fade; L[o] *= g; R[o] *= g; L[n - 1 - o] *= g; R[n - 1 - o] *= g; }
    return [L, R];
}

// a test picture instead of the recording (no extension needed): which recording, which second, 1x or not
function testPicture(id, wall, dense) {
    const c = new OffscreenCanvas(540, 960), x = c.getContext('2d');
    const hue = [...id].reduce((a, ch) => a + ch.charCodeAt(0) * 7, 0) % 360;
    x.fillStyle = `hsl(${hue} 35% ${dense ? 30 : 18}%)`; x.fillRect(0, 0, 540, 960);
    x.fillStyle = '#fff'; x.font = '700 30px system-ui'; x.textAlign = 'center';
    x.fillText(id, 270, 420);
    x.fillText(new Date(wall * 1000).toLocaleTimeString('ru-RU', { timeZone: 'America/Toronto' }), 270, 470);
    x.fillStyle = dense ? '#ff5a8a' : '#9fb4ff'; x.fillText(dense ? '1× со звуком' : 'таймлапс', 270, 520);
    return c;
}

/**
 * Build the digest. data = dev-log.json; hlsOf = recordings() (null: test pictures); writable = a
 * FileSystemWritableFileStream (the MP4 goes straight to disk) or nothing (Blob in memory, for short tests).
 * range = [from, to] video seconds to build only a piece (a test); onProgress({frame, frames, stage, mb, sound});
 * signal: AbortSignal; canvas: the preview canvas.
 */
export async function buildDevDigest({ data, T = 600, range = null, hlsOf = null, writable, canvas, onProgress = () => {}, signal, bitrate = 8e6 }) {
    const plan = schedule(data, T), all = plan.frames;
    const first = range ? Math.round(range[0] * FPS) : 0, frames = range ? Math.round(range[1] * FPS) : all;
    const cv = canvas || new OffscreenCanvas(W, H), ctx = cv.getContext('2d');
    const overlay = renderer(ctx, plan);

    // every frame's source; offsets resolved on the recording's own clock
    const src = Array.from({ length: frames }, (_, f) => {
        if (f < first) return null;
        const s = plan.sourceAt(f / FPS), hls = hlsOf?.[s.stream];
        const wall = s.at ?? (hls ? hls.start : data.streams[s.stream].start) + s.offset;
        return { stream: s.stream, wall, dense: s.dense, hls };
    });
    // runs: the same recording and mode; a 1x run also breaks where its time jumps (the parts of a montage)
    const runs = [];
    for (let f = first; f < frames; f++) {
        const s = src[f], r = f > first && runs[runs.length - 1], p = src[f - 1];
        if (r && p.stream === s.stream && p.dense === s.dense && (!s.dense || Math.abs(s.wall - p.wall - 1 / FPS) < 0.5)) r.to = f;
        else runs.push({ from: f, to: f, stream: s.stream, dense: s.dense, hls: s.hls });
    }

    const audioCodec = (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: RATE })) ? 'aac' : 'opus';
    const output = new Output({
        format: new Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' }),
        target: writable ? new StreamTarget(writable, { chunked: true }) : new BufferTarget(),
    });
    const video = new CanvasSource(cv, { codec: 'avc', bitrate, keyFrameInterval: 2 });
    const audio = new AudioSampleSource({ codec: audioCodec, quality: QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: FPS });
    output.addAudioTrack(audio);
    await output.start();

    let audioAt = 0, bytes = 0, sound = 0;
    async function silence(at) {
        const upTo = at - first / FPS;
        while (audioAt < upTo - 1e-6) {
            const len = Math.min(1, upTo - audioAt), n = Math.round(len * RATE);
            await audio.add(new AudioSample({ data: new Float32Array(n * 2), format: 'f32-planar', numberOfChannels: 2, sampleRate: RATE, timestamp: audioAt }));
            audioAt += n / RATE;
        }
    }
    async function frame(f, img) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        if (img) cover(ctx, img);
        overlay(f / FPS);
        await video.add((f - first) / FPS, 1 / FPS);
        if (f % 15 === 0) onProgress({ frame: f, frames, stage: 'frames', mb: Math.round(bytes / 1048576), sound });
    }

    const decodeKey = keyDecoder();
    let still = null;
    try {
        for (const run of runs) {
            const fs = Array.from({ length: run.to - run.from + 1 }, (_, k) => run.from + k);
            if (!run.hls) {                                        // test pictures, or a recording not found
                for (const f of fs) {
                    if (f % FPS === 0) await silence(f / FPS);
                    await frame(f, hlsOf ? still : testPicture(run.stream, src[f].wall, run.dense));
                }
                continue;
            }
            if (run.dense) {
                const walls = fs.map((f) => src[f].wall), chunks = [];
                let config = null;
                const onSegment = (b, clock, pts0) => {
                    bytes += b.length;
                    const a = audioFrames(b);
                    if (!a) return;
                    config ||= a;
                    for (const x of a.frames) chunks.push({ wall: clock + (x.pts - pts0), data: x.data });
                };
                const reader = hlsDense(run.hls, walls, 0, onSegment);
                for (const f of fs) {
                    const { value } = await reader.next();
                    if (value) still = value;
                    await frame(f, still);
                }
                await reader.return?.();
                const v0 = (run.from - first) / FPS, len = fs.length / FPS;
                const pcm = await stretchSound(chunks.filter((c) => c.wall >= walls[0] - 0.1 && c.wall <= walls[walls.length - 1] + 0.2), config, walls[0], len);
                await silence(v0 + first / FPS);
                if (pcm) {
                    const n = pcm[0].length, data = new Float32Array(n * 2);
                    data.set(pcm[0], 0); data.set(pcm[1], n);
                    await audio.add(new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: RATE, timestamp: audioAt }));
                    audioAt += n / RATE;
                    sound += len;
                }
                continue;
            }
            // timelapse: the key frame of each segment the run passes, read PREFETCH segments ahead
            const segs = run.hls.segments;
            const segOf = (wall) => { let lo = 0, hi = segs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].at <= wall) lo = m; else hi = m - 1; } return lo; };
            const seg = fs.map((f) => segOf(src[f].wall));
            const order = [...new Set(seg)], cache = new Map();
            const load = (k) => { if (k >= 0 && k < order.length && !cache.has(order[k])) cache.set(order[k], keyFrame(segs[order[k]].url).catch(() => null)); };
            let shown = -1;
            for (let i = 0; i < fs.length; i++) {
                if (fs[i] % FPS === 0) await silence(fs[i] / FPS);
                if (seg[i] !== shown) {
                    const k = order.indexOf(seg[i]);            // a run's time may step back (two lines' stretches)
                    for (let j = k; j < k + PREFETCH; j++) load(j);
                    const kf = await cache.get(seg[i]);
                    cache.delete(seg[i]);
                    if (kf) { bytes += kf.bytes || 0; const pic = await decodeKey(kf); if (pic) still = pic; }
                    shown = seg[i];
                }
                await frame(fs[i], still);
            }
        }
        await silence(frames / FPS);
        video.close(); audio.close();
        onProgress({ frame: frames, frames, stage: 'mux', mb: Math.round(bytes / 1048576), sound });
        await output.finalize();
    } catch (e) {
        await output.cancel().catch(() => {});
        throw e;
    }
    return writable ? null : new Blob([output.target.buffer], { type: 'video/mp4' });
}

export { schedule };
