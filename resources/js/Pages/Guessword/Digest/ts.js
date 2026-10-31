// MPEG-TS, only what the digest needs from a LIVE Center HLS segment: its first video access unit
// (a segment starts with a key frame), as Annex B bytes + PTS. Works on the first bytes of a segment
// (HTTP Range): returns null when the frame is not complete yet, so the caller asks for more bytes.

const STREAMS = { 0x1b: 'avc', 0x24: 'hevc' };

export function firstVideoFrame(b) {
    let pmt = -1, video = -1, codec = null, pes = null, pts = null;
    const parts = [];
    for (let i = 0; i + 188 <= b.length; i += 188) {
        if (b[i] !== 0x47) return null;                       // lost sync: not a TS start
        const pusi = b[i + 1] & 0x40, pid = ((b[i + 1] & 0x1f) << 8) | b[i + 2], afc = (b[i + 3] >> 4) & 3;
        let p = i + 4;
        if (afc & 2) p += 1 + b[p];
        if (!(afc & 1) || p >= i + 188) continue;
        if (pid === 0 && pusi) {
            p += 1 + b[p];
            pmt = ((b[p + 10] & 0x1f) << 8) | b[p + 11];
        } else if (pid === pmt && pusi && video < 0) {
            p += 1 + b[p];
            const end = p + 3 + (((b[p + 1] & 0x0f) << 8) | b[p + 2]) - 4;
            let q = p + 12 + (((b[p + 10] & 0x0f) << 8) | b[p + 11]);
            while (q < end) {
                if (STREAMS[b[q]]) { codec = STREAMS[b[q]]; video = ((b[q + 1] & 0x1f) << 8) | b[q + 2]; break; }
                q += 5 + (((b[q + 3] & 0x0f) << 8) | b[q + 4]);
            }
        } else if (pid === video) {
            if (pusi) {
                if (pes) return { codec, pts, data: concat(parts) };   // the next frame starts: the first one is whole
                pes = true;
                const flags = b[p + 7], hl = b[p + 8];
                if (flags & 0x80) pts = ((b[p + 9] & 0x0e) * 536870912 + b[p + 10] * 4194304 + (b[p + 11] & 0xfe) * 16384 + b[p + 12] * 128 + (b[p + 13] >> 1)) / 90000;
                p += 9 + hl;
            }
            if (pes) parts.push(b.subarray(p, i + 188));
        }
    }
    return null;
}

/**
 * Every video access unit of a whole segment, in decode order: [{pts, key, data}] and the codec. For the stretches
 * the digest plays slowly (the cake show): those need every frame, not only the segment's first one.
 */
export function videoFrames(b) {
    let pmt = -1, video = -1, codec = null, cur = null;
    const out = [];
    const close = () => { if (cur) { const data = concat(cur.parts); out.push({ pts: cur.pts, key: isKey(codec, data), data }); } };
    for (let i = 0; i + 188 <= b.length; i += 188) {
        if (b[i] !== 0x47) break;
        const pusi = b[i + 1] & 0x40, pid = ((b[i + 1] & 0x1f) << 8) | b[i + 2], afc = (b[i + 3] >> 4) & 3;
        let p = i + 4;
        if (afc & 2) p += 1 + b[p];
        if (!(afc & 1) || p >= i + 188) continue;
        if (pid === 0 && pusi) {
            p += 1 + b[p];
            pmt = ((b[p + 10] & 0x1f) << 8) | b[p + 11];
        } else if (pid === pmt && pusi && video < 0) {
            p += 1 + b[p];
            const end = p + 3 + (((b[p + 1] & 0x0f) << 8) | b[p + 2]) - 4;
            let q = p + 12 + (((b[p + 10] & 0x0f) << 8) | b[p + 11]);
            while (q < end) {
                if (STREAMS[b[q]]) { codec = STREAMS[b[q]]; video = ((b[q + 1] & 0x1f) << 8) | b[q + 2]; break; }
                q += 5 + (((b[q + 3] & 0x0f) << 8) | b[q + 4]);
            }
        } else if (pid === video) {
            if (pusi) {
                close();
                const flags = b[p + 7], hl = b[p + 8];
                const pts = flags & 0x80 ? ((b[p + 9] & 0x0e) * 536870912 + b[p + 10] * 4194304 + (b[p + 11] & 0xfe) * 16384 + b[p + 12] * 128 + (b[p + 13] >> 1)) / 90000 : null;
                cur = { pts, parts: [] };
                p += 9 + hl;
            }
            if (cur) cur.parts.push(b.subarray(p, i + 188));
        }
    }
    close();
    return { codec, frames: out.filter((f) => f.pts !== null) };
}

/**
 * The AAC audio of a whole segment (ADTS in PES, stream type 0x0f): {sampleRate, channels, description (the
 * AudioSpecificConfig for AudioDecoder), frames: [{pts, data (raw AAC, ADTS header cut)}]} or null.
 * For the stretches the development digest plays at 1x with their sound.
 */
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
export function audioFrames(b) {
    let pmt = -1, audio = -1, cur = null;
    const pes = [];
    for (let i = 0; i + 188 <= b.length; i += 188) {
        if (b[i] !== 0x47) break;
        const pusi = b[i + 1] & 0x40, pid = ((b[i + 1] & 0x1f) << 8) | b[i + 2], afc = (b[i + 3] >> 4) & 3;
        let p = i + 4;
        if (afc & 2) p += 1 + b[p];
        if (!(afc & 1) || p >= i + 188) continue;
        if (pid === 0 && pusi) {
            p += 1 + b[p];
            pmt = ((b[p + 10] & 0x1f) << 8) | b[p + 11];
        } else if (pid === pmt && pusi && audio < 0) {
            p += 1 + b[p];
            const end = p + 3 + (((b[p + 1] & 0x0f) << 8) | b[p + 2]) - 4;
            let q = p + 12 + (((b[p + 10] & 0x0f) << 8) | b[p + 11]);
            while (q < end) {
                if (b[q] === 0x0f) { audio = ((b[q + 1] & 0x1f) << 8) | b[q + 2]; break; }
                q += 5 + (((b[q + 3] & 0x0f) << 8) | b[q + 4]);
            }
        } else if (pid === audio) {
            if (pusi) {
                if (cur) pes.push(cur);
                const flags = b[p + 7], hl = b[p + 8];
                const pts = flags & 0x80 ? ((b[p + 9] & 0x0e) * 536870912 + b[p + 10] * 4194304 + (b[p + 11] & 0xfe) * 16384 + b[p + 12] * 128 + (b[p + 13] >> 1)) / 90000 : null;
                cur = { pts, parts: [] };
                p += 9 + hl;
            }
            if (cur) cur.parts.push(b.subarray(p, i + 188));
        }
    }
    if (cur) pes.push(cur);
    let sampleRate = 0, channels = 0, profile = 1;
    const frames = [];
    for (const x of pes) {
        if (x.pts === null) continue;
        const d = concat(x.parts);
        let k = 0;
        for (let o = 0; o + 7 <= d.length;) {
            if (d[o] !== 0xff || (d[o + 1] & 0xf0) !== 0xf0) { o++; continue; }   // ADTS sync word
            const len = ((d[o + 3] & 3) << 11) | (d[o + 4] << 3) | (d[o + 5] >> 5);
            const head = d[o + 1] & 1 ? 7 : 9;
            if (len < head || o + len > d.length) break;
            profile = (d[o + 2] >> 6) & 3;
            sampleRate = RATES[(d[o + 2] >> 2) & 0xf] || sampleRate;
            channels = ((d[o + 2] & 1) << 2) | (d[o + 3] >> 6) || channels;
            frames.push({ pts: x.pts + (k++ * 1024) / (sampleRate || 48000), data: d.slice(o + head, o + len) });
            o += len;
        }
    }
    if (!frames.length || !sampleRate) return null;
    const object = profile + 1, sri = RATES.indexOf(sampleRate);
    const description = new Uint8Array([(object << 3) | (sri >> 1), ((sri & 1) << 7) | (channels << 3)]);
    return { sampleRate, channels, description, frames };
}

// a random access picture: HEVC IRAP (NAL types 16-21), H.264 IDR (5)
function isKey(codec, d) {
    for (let i = 0; i + 3 < d.length; i++) {
        if (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 1) continue;
        const t = codec === 'hevc' ? (d[i + 3] >> 1) & 0x3f : d[i + 3] & 0x1f;
        if (codec === 'hevc' ? t >= 16 && t <= 21 : t === 5) return true;
        if (codec === 'hevc' ? t < 32 : t >= 1 && t <= 5) return false;   // the picture's first slice decides
    }
    return false;
}

function concat(parts) {
    const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
    let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
}

/** codec string for VideoDecoder from the frame's SPS (Annex B, no description) */
export function codecString(codec, data) {
    for (let i = 0; i + 4 < data.length; i++) {
        if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 1) continue;
        const n = i + 3;
        if (codec === 'avc' && (data[n] & 0x1f) === 7) {
            return 'avc1.' + [data[n + 1], data[n + 2], data[n + 3]].map((x) => x.toString(16).padStart(2, '0')).join('');
        }
        if (codec === 'hevc' && ((data[n] >> 1) & 0x3f) === 33) {
            // SPS without its emulation prevention bytes (00 00 03 -> 00 00): 2 header bytes, then 1 byte
            // (vps id / max sub layers / nesting), then profile_tier_level, the level 11 bytes into it
            const s = [];
            for (let j = n; j < data.length && s.length < 16; j++) {
                if (data[j] === 3 && s.length >= 2 && s[s.length - 1] === 0 && s[s.length - 2] === 0) continue;
                s.push(data[j]);
            }
            const profile = s[3] & 0x1f, tier = (s[3] >> 5) & 1, level = s[14];
            return `hev1.${profile}.6.${tier ? 'H' : 'L'}${level}.90`;
        }
    }
    return codec === 'avc' ? 'avc1.640028' : 'hev1.1.6.L120.90';
}
