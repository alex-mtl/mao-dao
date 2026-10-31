// "Champion race" digest, part 3 of 3: the clip itself, built in the browser (Chrome / Edge, WebCodecs).
// The recording (hours long, gigabytes) is never loaded whole. Two sources of the key frames each clip frame
// needs: a local MP4 (mediabunny reads its index, then one key frame per clip frame via File.slice) or the
// LIVE Center recording through the browser extension (livecenter.js: the first bytes of each HLS segment).
// Each frame = that key frame + the overlay of draw.js; encoded to H.264, packed into an MP4 in memory.
import { ALL_FORMATS, BlobSource, BufferTarget, CanvasSource, EncodedPacketSink, Input, Mp4OutputFormat, Output, VideoSampleSink } from 'mediabunny';
import { renderer, W, H } from './draw.js';
import { keyFrame, segment } from './livecenter.js';
import { FPS } from './model.js';
import { codecString, videoFrames } from './ts.js';

/** the recording's length in seconds and video codec, from its index only */
export async function probe(file) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    return { duration: await input.computeDuration(), codec: track.codec, width: track.displayWidth, height: track.displayHeight };
}

const encodable = async () => (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: W, height: H, bitrate: 8e6, framerate: FPS })).supported;

/** can this browser decode the recording and encode H.264? null = yes, otherwise a reason */
export async function unsupported(file) {
    if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') return 'webcodecs';
    try {
        const track = await new Input({ source: new BlobSource(file), formats: ALL_FORMATS }).getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) return 'decode';
    } catch {
        return 'format';
    }
    return (await encodable()) ? null : 'encode';
}

/** the same for a LIVE Center recording, from the key frame of its first segment */
export async function unsupportedHls(hls) {
    if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') return 'webcodecs';
    const k = await keyFrame(hls.segments[0].url);
    if (!(await VideoDecoder.isConfigSupported({ codec: k.codec, codedWidth: W, codedHeight: H })).supported) return 'decode';
    return (await encodable()) ? null : 'encode';
}

// key frames of a local MP4 for the given stream seconds: {keys: [{us, get() -> {chunk, config}}], keyOf}
async function fileKeys(file, times) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new EncodedPacketSink(track);
    const config = await track.getDecoderConfig();
    const first = await sink.getFirstPacket({ metadataOnly: true });
    const keys = [], keyOf = [];
    for (const t of times) {
        const p = (await sink.getKeyPacket(t, { metadataOnly: true })) || first;
        if (!keys.length || keys[keys.length - 1].seq !== p.sequenceNumber) {
            keys.push({
                seq: p.sequenceNumber, us: Math.round(p.timestamp * 1e6),
                get: async () => ({ chunk: (await sink.getKeyPacket(p.timestamp, { verifyKeyPackets: false })).toEncodedVideoChunk(), config }),
            });
        }
        keyOf.push(keys.length - 1);
    }
    return { keys, keyOf };
}

// key frames of a LIVE Center recording: stream second t of the LIVE log = unix time start + t, placed
// in the segment that covers it by the playlist's clock (exact, also when the recording began earlier).
// Segments are read PREFETCH at a time: the network, not the decoder, is the slow part. TikTok's CDN
// serves each request slowly (~0.2 MB/s), so many at once (measured 30.10: 8 -> 3 segments/s,
// 48 -> 13-15/s, more gives nothing on a ~60 Mbit/s line). 48 x 512 KB in memory at most.
function hlsKeys(hls, times, start) {
    const segs = hls.segments, PREFETCH = 48;
    const at = (wall) => {
        let lo = 0, hi = segs.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].at <= wall) lo = mid; else hi = mid - 1; }
        return lo;
    };
    const keys = [], keyOf = [], cache = new Map();
    for (const t of times) {
        const i = at(start + t);
        if (!keys.length || keys[keys.length - 1].seg !== i) keys.push({ seg: i, us: Math.round((segs[i].at - hls.start) * 1e6) });
        keyOf.push(keys.length - 1);
    }
    const load = (k) => {
        if (k < keys.length && !cache.has(k)) cache.set(k, keyFrame(segs[keys[k].seg].url).catch((e) => ({ error: e })));
    };
    keys.forEach((key, k) => {
        key.get = async () => {
            for (let j = k; j < k + PREFETCH; j++) load(j);
            const f = await cache.get(k);
            cache.delete(k);
            if (f.error) throw f.error;
            return { chunk: new EncodedVideoChunk({ type: 'key', timestamp: key.us, data: f.data }), config: { codec: f.codec }, bytes: f.bytes };
        };
    });
    return { keys, keyOf };
}

// Every frame of a stretch played slowly (a cake show): one picture (a canvas, or null) per stream second of
// `times` (ascending), the newest frame at or before it. A local file: mediabunny decodes the stretch in order.
async function* fileDense(file, times) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const sink = new VideoSampleSink(await input.getPrimaryVideoTrack());
    for await (const s of sink.samplesAtTimestamps(times)) {
        if (!s) { yield null; continue; }
        const c = new OffscreenCanvas(W, H);
        s.draw(c.getContext('2d'), 0, 0, W, H);
        s.close();
        yield c;
    }
}

// The same from LIVE Center: whole segments of the stretch (read a few ahead), every access unit decoded in
// order; a frame's stream time = its segment's clock (#EXT-X-PROGRAM-DATE-TIME) + its PTS offset in the segment.
// A decoder error (a reconnect with new parameters) starts a new decoder at the next segment.
// onSegment(bytes, clock, pts0): each segment as it is read (the development digest takes its sound from it).
export async function* hlsDense(hls, times, start, onSegment) {
    const segs = hls.segments, AHEAD = 4;
    const segOf = (wall) => { let lo = 0, hi = segs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].at <= wall) lo = m; else hi = m - 1; } return lo; };
    const walls = times.map((t) => start + t), first = segOf(walls[0]), last = segOf(walls[walls.length - 1]);
    const loads = new Map();
    const load = (i) => { if (i <= last && !loads.has(i)) loads.set(i, segment(segs[i].url).catch(() => null)); };
    const us = (wall) => Math.round((wall - hls.start) * 1e6);
    // frames come out in presentation order; each one is kept only until the next one shows it is the newest
    // at or before a target, and a target gets a copy on a canvas: a hardware decoder stops while its frames
    // (or clones of them) are held, and flush() would then wait forever
    const got = [];                            // per target: an OffscreenCanvas or null
    let decoder = null, codec = null, broken = false, out = 0, given = 0, prev = null;
    const copy = (f) => {
        const c = new OffscreenCanvas(W, H);
        c.getContext('2d').drawImage(f, 0, 0, W, H);
        return c;
    };
    const take = (f) => {
        let shot = null;
        while (out < walls.length && f.timestamp > us(walls[out])) got[out++] = prev ? (shot ||= copy(prev)) : null;
        prev?.close();
        prev = f;
    };
    const open = () => {
        decoder = new VideoDecoder({ output: take, error: () => { broken = true; } });
        codec = null;
    };
    // hand out the targets resolved so far (all of them at the end)
    function* give(all) {
        if (all) { const last = prev && copy(prev); while (out < walls.length) got[out++] = last; }
        while (given < out) { yield got[given]; got[given++] = undefined; }
    }
    open();
    for (let i = first; i <= last; i++) {
        for (let j = i; j < i + AHEAD; j++) load(j);
        const bytes = await loads.get(i);
        loads.delete(i);
        if (broken) { try { decoder.close(); } catch { /* closed */ } open(); broken = false; }
        const v = bytes && videoFrames(bytes);
        if (v && v.frames.length) {
            const pts0 = Math.min(...v.frames.map((f) => f.pts));
            onSegment?.(bytes, segs[i].at, pts0);
            for (const f of v.frames) {
                if (!codec) {
                    if (!f.key) continue;               // a new decoder starts at a key frame
                    codec = codecString(v.codec, f.data);
                    decoder.configure({ codec });
                }
                decoder.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: us(segs[i].at + f.pts - pts0), data: f.data }));
            }
        }
        yield* give(false);
    }
    if (codec && !broken) await decoder.flush().catch(() => {});
    yield* give(true);
    prev?.close();
    try { decoder.close(); } catch { /* closed */ }
}

/**
 * Build the clip from a local file (file) or a LIVE Center recording (hls = playlist() of livecenter.js, with
 * liveStart = unix time of the LIVE log's second 0). model: digestModel(...) whose stream seconds are the
 * log's (file: second 0 of the file = second 0 of the log). Returns a Blob (video/mp4).
 * onProgress({frame, frames, stage, lost, mb}); signal: AbortSignal; canvas: optional W x H canvas to draw
 * on (the page shows it as a live preview); bitrate in bits/s.
 */
export async function buildDigest({ file, hls, liveStart = 0, model, avatars, labels, onProgress = () => {}, signal, canvas, bitrate = 8e6 }) {
    const frames = Math.round(model.video * FPS);
    const cv = canvas || new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d');
    const draw = renderer(ctx, model, { avatars, labels });

    // plan: clip frame -> stream second -> the key frame at or before it (several frames may share one);
    // frames inside a cake show are "dense": every frame of that stretch, decoded in order (fileDense / hlsDense)
    onProgress({ frame: 0, frames, stage: 'index' });
    const times = Array.from({ length: frames }, (_, f) => model.streamAt(f / FPS).t);
    const dense = Array.from({ length: frames }, (_, f) => model.slowAt(f / FPS));
    const sparse = times.filter((_, f) => !dense[f]);
    const plan = hls ? hlsKeys(hls, sparse.length ? sparse : [0], liveStart) : await fileKeys(file, sparse.length ? sparse : [0]);
    const keys = plan.keys, keyOf = [];
    for (let f = 0, j = 0; f < frames; f++) keyOf.push(dense[f] ? -1 : plan.keyOf[j++]);
    // the stretches: [first frame, last frame], each gets its own reader when the clip reaches it
    const stretches = [];
    for (let f = 0; f < frames; f++) if (dense[f]) { if (stretches.length && stretches[stretches.length - 1][1] === f - 1) stretches[stretches.length - 1][1] = f; else stretches.push([f, f]); }
    let reader = null, readerEnd = -1, still = null;

    // decode only those key frames, a few ahead of the frame being drawn. Recordings can have damaged
    // spots (19.10: ~6:34 h, ffmpeg fails there too) and segments can fail to load: a decoder error opens a
    // new decoder, the keys it lost keep the previous picture.
    const decoded = [];
    let decoder, config = null, broken = false, wake = null, bytes = 0;
    const notify = () => { if (wake) { wake(); wake = null; } };
    const open = () => {
        decoder = new VideoDecoder({
            output: (f) => { got++; decoded.push(f); notify(); },
            error: () => { broken = true; notify(); },
        });
        if (config) decoder.configure(config);
    };
    open();
    let fed = 0, got = 0, flushing = null, flushed = false, lostBefore = 0, lost = 0;
    const skipped = new Set();
    const AHEAD = 6;
    async function feed(upTo) {
        while (!broken && fed < keys.length && fed <= upTo + AHEAD && decoder.decodeQueueSize < AHEAD) {
            const i = fed++;
            let k;
            try {
                k = await keys[i].get();
            } catch {
                skipped.add(i);
                got++;              // counted as handled: the previous picture stays
                continue;
            }
            bytes += k.bytes || 0;
            if (!config || k.config.codec !== config.codec) {
                config = k.config;
                decoder.configure(config);
            }
            decoder.decode(k.chunk);
        }
        if (!broken && fed === keys.length && !flushing) flushing = decoder.flush().then(() => { flushed = true; notify(); }, () => { broken = true; notify(); });
    }
    // the decoded frame of key i (a dropped, lost or skipped one: the nearest earlier frame stays)
    let current = null, currentKey = -1;
    async function frameOf(i) {
        const us = keys[i].us;
        for (;;) {
            if (broken) {
                broken = false;
                lost = fed - got;
                lostBefore = fed;
                flushing = null;
                if (decoder.state !== 'closed') decoder.close();
                open();
            }
            while (decoded.length && decoded[0].timestamp <= us) {
                current?.close();
                current = decoded.shift();
            }
            if (current && current.timestamp === us) return current;
            if (decoded.length || flushed || i < lostBefore || skipped.has(i)) return current;
            await feed(i);
            await new Promise((r) => { wake = r; setTimeout(r, 50); });
        }
    }

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new CanvasSource(cv, { codec: 'avc', bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();

    const progress = (frame, stage) => onProgress({ frame, frames, stage, lost: lost + skipped.size, mb: Math.round(bytes / 1048576) });
    try {
        for (let f = 0; f < frames; f++) {
            if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
            ctx.clearRect(0, 0, W, H);
            if (dense[f]) {
                if (f > readerEnd) {
                    const [a, b] = stretches.find(([x, y]) => x <= f && f <= y);
                    const ts = times.slice(a, b + 1);
                    reader = hls ? hlsDense(hls, ts, liveStart) : fileDense(file, ts);
                    readerEnd = b;
                }
                const { value } = await reader.next();
                if (value) still = value;
                const img = still || current;
                if (img) ctx.drawImage(img, 0, 0, W, H);
            } else {
                if (keyOf[f] !== currentKey) {
                    await feed(keyOf[f]);
                    await frameOf(keyOf[f]);
                    currentKey = keyOf[f];
                }
                if (current) ctx.drawImage(current, 0, 0, W, H);
            }
            draw(f / FPS);
            await source.add(f / FPS, 1 / FPS);
            if (f % 15 === 0) progress(f, 'frames');
        }
        source.close();
        progress(frames, 'mux');
        await output.finalize();
    } catch (e) {
        await output.cancel().catch(() => {});
        throw e;
    } finally {
        current?.close();
        await reader?.return?.();
        decoded.forEach((x) => x.close());
        if (decoder.state !== 'closed') decoder.close();
    }
    return new Blob([output.target.buffer], { type: 'video/mp4' });
}
