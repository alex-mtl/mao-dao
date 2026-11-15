// A piece of a local recording as an HLS playlist with #EXT-X-PROGRAM-DATE-TIME, the way LIVE Center serves it: for testing the
// mao-dao site's clip builder without TikTok (quiz tests/clip/e2e.mjs).
//   node hls-cut.js <recording.mp4> <from recording second> <length s> <out dir> <unix time of the recording's second 0>
// Segments are copied (no re-encoding), ~4 s each at key frames; each carries its wall-clock start.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const [src, from, len, outDir, wall0] = process.argv.slice(2);
if (!wall0) { console.error('usage: see the header of this file'); process.exit(1); }
const FF = path.join(os.homedir(), 'Downloads/ffmpeg-2024-11-06-git-4047b887fc-full_build/bin/ffmpeg.exe');
fs.mkdirSync(outDir, { recursive: true });
const r = spawnSync(FF, ['-nostdin', '-loglevel', 'error', '-y', '-ss', from, '-t', len, '-i', src, '-c', 'copy', '-f', 'hls',
  '-hls_time', '4', '-hls_list_size', '0', '-hls_segment_type', 'mpegts', '-hls_segment_filename', path.join(outDir, 'seg%04d.ts'), path.join(outDir, 'raw.m3u8')], { stdio: 'inherit' });
if (r.status) process.exit(r.status);
let at = Number(wall0) + Number(from);
const out = [];
for (const line of fs.readFileSync(path.join(outDir, 'raw.m3u8'), 'utf8').split('\n')) {
  if (line.startsWith('#EXTINF:')) {
    out.push('#EXT-X-PROGRAM-DATE-TIME:' + new Date(at * 1000).toISOString());
    at += parseFloat(line.slice(8));
  }
  out.push(line);
}
fs.writeFileSync(path.join(outDir, 'index.m3u8'), out.join('\n'));
console.log('written', path.join(outDir, 'index.m3u8'));
