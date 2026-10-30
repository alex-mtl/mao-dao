// "Champion race" digest, part 3 of 3: the clip itself, built in the browser (Chrome / Edge, WebCodecs).
// The recording (LIVE Center MP4, hours long, gigabytes) is never loaded: mediabunny reads its index and
// then only the one key frame each clip frame needs (File.slice). Each frame = that key frame + the
// overlay of draw.js; encoded to H.264 and packed into an MP4 in memory (a minute is ~60 MB).
import { ALL_FORMATS, BlobSource, BufferTarget, CanvasSource, EncodedPacketSink, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { renderer, W, H } from './draw.js';
import { FPS } from './model.js';

/** the recording's length in seconds and video codec, from its index only */
export async function probe(file) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    return { duration: await input.computeDuration(), codec: track.codec, width: track.displayWidth, height: track.displayHeight };
}

/** can this browser decode the recording and encode H.264? null = yes, otherwise a reason */
export async function unsupported(file) {
    if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') return 'webcodecs';
    try {
        const track = await new Input({ source: new BlobSource(file), formats: ALL_FORMATS }).getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) return 'decode';
    } catch {
        return 'format';
    }
    const enc = await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: W, height: H, bitrate: 8e6, framerate: FPS });
    return enc.supported ? null : 'encode';
}

/**
 * Build the clip. model: digestModel(...) with stream = the file's duration. Returns a Blob (video/mp4).
 * onProgress({frame, frames, stage}); signal: AbortSignal; canvas: optional W x H canvas to draw on
 * (the page shows it as a live preview); bitrate in bits/s.
 */
export async function buildDigest({ file, model, avatars, labels, onProgress = () => {}, signal, canvas, bitrate = 8e6 }) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new EncodedPacketSink(track);
    const frames = Math.round(model.video * FPS);
    const cv = canvas || new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d');
    const draw = renderer(ctx, model, { avatars, labels });

    // plan: clip frame -> stream second -> the key frame at or before it (several frames may share one)
    onProgress({ frame: 0, frames, stage: 'index' });
    const first = await sink.getFirstPacket({ metadataOnly: true });
    const keys = [], keyOf = [];
    for (let f = 0; f < frames; f++) {
        const t = model.streamAt(f / FPS).t;
        const p = (await sink.getKeyPacket(t, { metadataOnly: true })) || first;
        if (!keys.length || keys[keys.length - 1].sequenceNumber !== p.sequenceNumber) keys.push(p);
        keyOf.push(keys.length - 1);
    }

    // decode only those key frames, a few ahead of the frame being drawn. Recordings can have damaged
    // spots (19.10: ~6:34 h, ffmpeg fails there too): a decoder error opens a new decoder, the keys it
    // lost keep the previous picture.
    const config = await track.getDecoderConfig();
    const decoded = [];
    let decoder, broken = false, wake = null;
    const notify = () => { if (wake) { wake(); wake = null; } };
    const open = () => {
        decoder = new VideoDecoder({
            output: (f) => { got++; decoded.push(f); notify(); },
            error: () => { broken = true; notify(); },
        });
        decoder.configure(config);
    };
    open();
    let fed = 0, got = 0, flushing = null, flushed = false, lostBefore = 0, lost = 0;
    const AHEAD = 6;
    async function feed(upTo) {
        while (!broken && fed < keys.length && fed <= upTo + AHEAD && decoder.decodeQueueSize < AHEAD) {
            const p = await sink.getKeyPacket(keys[fed].timestamp, { verifyKeyPackets: false });
            decoder.decode(p.toEncodedVideoChunk());
            fed++;
        }
        if (!broken && fed === keys.length && !flushing) flushing = decoder.flush().then(() => { flushed = true; notify(); }, () => { broken = true; notify(); });
    }
    // the decoded frame of key i (a dropped or lost one: the nearest earlier frame stays)
    let current = null, currentKey = -1;
    async function frameOf(i) {
        const us = Math.round(keys[i].timestamp * 1e6);
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
            if (decoded.length || flushed || i < lostBefore) return current;
            await feed(i);
            await new Promise((r) => { wake = r; setTimeout(r, 50); });
        }
    }

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new CanvasSource(cv, { codec: 'avc', bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();

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
            if (f % 15 === 0) onProgress({ frame: f, frames, stage: 'frames', lost });
        }
        source.close();
        onProgress({ frame: frames, frames, stage: 'mux', lost });
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
