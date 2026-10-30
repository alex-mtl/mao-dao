// "Champion race" digest, part 3 of 3: the clip itself, built in the browser (Chrome / Edge, WebCodecs).
// The recording (hours long, gigabytes) is never loaded whole. Two sources of the key frames each clip frame
// needs: a local MP4 (mediabunny reads its index, then one key frame per clip frame via File.slice) or the
// LIVE Center recording through the browser extension (livecenter.js: the first bytes of each HLS segment).
// Each frame = that key frame + the overlay of draw.js; encoded to H.264, packed into an MP4 in memory.
import { ALL_FORMATS, BlobSource, BufferTarget, CanvasSource, EncodedPacketSink, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { renderer, W, H } from './draw.js';
import { keyFrame } from './livecenter.js';
import { FPS } from './model.js';

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
// Segments are read PREFETCH at a time: the network, not the decoder, is the slow part.
function hlsKeys(hls, times, start) {
    const segs = hls.segments, PREFETCH = 8;
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

    // plan: clip frame -> stream second -> the key frame at or before it (several frames may share one)
    onProgress({ frame: 0, frames, stage: 'index' });
    const times = Array.from({ length: frames }, (_, f) => model.streamAt(f / FPS).t);
    const { keys, keyOf } = hls ? hlsKeys(hls, times, liveStart) : await fileKeys(file, times);

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
            if (keyOf[f] !== currentKey) {
                await feed(keyOf[f]);
                await frameOf(keyOf[f]);
                currentKey = keyOf[f];
            }
            ctx.clearRect(0, 0, W, H);
            if (current) ctx.drawImage(current, 0, 0, W, H);
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
        decoded.forEach((x) => x.close());
        if (decoder.state !== 'closed') decoder.close();
    }
    return new Blob([output.target.buffer], { type: 'video/mp4' });
}
