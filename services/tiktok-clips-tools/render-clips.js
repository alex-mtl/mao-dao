// Renders TikTok clips from a long stream recording: a plain cut and a branded version with "easy" effects.
// Usage: node render-clips.js <clips-final.json> <words.json> <outDir> [clipId ...] [--plain]
// ffmpeg runs at high OS priority on all cores: the game no longer runs on this PC, speed matters.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chunkWords, displayLines } = require('./subtitle-chunks');

const FF = path.join(os.homedir(), 'Downloads/ffmpeg-2024-11-06-git-4047b887fc-full_build/bin/ffmpeg.exe');
const FONT_SRC = 'C:/Windows/Fonts/ariblk.ttf';
const FONT = 'font.ttf';                         // copied into each work dir: drive-letter colons break filter option parsing
const W = 1080, H = 1920, FPS = 30;
// Sources below 1080x1920 (8h+ streams are 720x1280) are upscaled first; a no-op for 1080x1920 input.
const SRC_SCALE = `scale=${W}:${H}:flags=lanczos,`;
const FACE_Y = 330, GAME_Y = 1250;               // vertical focus points of the stream layout (camera top, game below)
// Text stays off the face (camera = top third): subtitles in the lower third, above TikTok's bottom caption UI.
const SUB_Y = 1490, HOOK_Y = 1230, CTA_Y = 1120;
const BRAND = { cyan: '22E5FF', green: '7CFF4F', pink: 'FF3EA5', dark: '1A0B2E' };
const ENC = ['-vcodec', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-acodec', 'aac', '-ab', '160k', '-ar', '48000', '-movflags', '+faststart'];

const [, , specPath, wordsPath, outDir, ...rest] = process.argv;
const WITH_PLAIN = rest.includes('--plain');        // plain cuts are optional: the user publishes only the fx versions
const only = rest.filter(a => !a.startsWith('--'));
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); // PowerShell writes a BOM
const spec = readJson(specPath);
const words = Object.values(readJson(wordsPath)).flatMap(f => f.words);

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(FF, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, windowsHide: true });
    try { os.setPriority(p.pid, os.constants.priority.PRIORITY_HIGH); } catch {}
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(0, 1500)}`)));
  });
}
const sec = t => typeof t === 'number' ? t : t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
const assTime = t => { const cs = Math.max(0, Math.round(t * 100)); const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };

// ---------- sound effects (synthesized, no downloads) ----------
const SFX = {
  ding: "aevalsrc='0.5*sin(2*PI*1760*t)*exp(-6*t)+0.3*sin(2*PI*2637*t)*exp(-7*t)':d=0.9",
  tada: "aevalsrc='0.4*(sin(2*PI*523*t)+sin(2*PI*659*t))*lt(t,0.16)*exp(-4*t)+0.35*(sin(2*PI*784*t)+sin(2*PI*988*t)+sin(2*PI*1319*t))*gte(t,0.18)*exp(-2.5*(t-0.18))':d=1.4",
  boom: "aevalsrc='0.9*sin(2*PI*(55+80*exp(-8*t))*t)*exp(-4*t)':d=0.8",
  whoosh: "anoisesrc=d=0.5:c=pink:a=0.6,highpass=f=400,lowpass=f=3000,afade=t=in:d=0.2,afade=t=out:st=0.25:d=0.25",
};
async function makeSfx(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, src] of Object.entries(SFX)) {
    const f = path.join(dir, `${name}.wav`);
    if (!fs.existsSync(f)) await run(['-f', 'lavfi', '-i', src, '-ac', '2', '-ar', '48000', f]);
  }
}

// ---------- timeline: source parts -> output segments ----------
// Effects version: freeze points split a main part; ff parts become a fast-forward from keyframe stills.
function buildSegments(clip, withFx) {
  const segs = [];
  for (const p of clip.parts) {
    const from = sec(p.from), to = sec(p.to);
    if (p.kind === 'ff') { if (withFx) segs.push({ kind: 'ff', from, to, frames: p.frames }); continue; }
    const fr = withFx && clip.fx?.freeze && sec(clip.fx.freeze.at) > from && sec(clip.fx.freeze.at) < to ? sec(clip.fx.freeze.at) : null;
    if (fr) {
      segs.push({ kind: 'main', from, to: fr });
      segs.push({ kind: 'still', from: fr, to: fr, dur: clip.fx.freeze.dur || 1.2 });
      segs.push({ kind: 'main', from: fr, to });
    }
    else segs.push({ kind: 'main', from, to });
  }
  let t = 0;
  for (const s of segs) {
    s.outStart = t;
    s.outDur = s.kind === 'ff' ? ffFrames(s) / FPS : s.kind === 'still' ? s.dur : (s.to - s.from);
    t += s.outDur;
  }
  return { segs, total: t };
}
const ffFrames = s => s.frames || Math.max(120, Math.min(240, Math.round((s.to - s.from) / 3)));   // part.frames: shorter jumps
// Map an absolute stream time to output time (only inside main segments).
function mapTime(segs, at) {
  for (const s of segs) if (s.kind === 'main' && at >= s.from && at <= s.to) return s.outStart + (at - s.from);
  return null;
}

// ---------- subtitles (ASS, word-by-word highlight) ----------
// Whisper hallucinations on music/silence (credits of Russian subtitle teams etc.)
const JUNK = /субтитр|dimatorzok|торзок|негода|семкин|егоров|дубровск/i;
function clipWords(clip) {
  const rep = clip.replace || {};
  // noSubs: [[from, to], ...] stream-time ranges without subtitles (game TTS over speech);
  // edits: [{ at, w }] fixes one word starting at `at` (±0.06 s), w = '' drops it.
  const mute = (clip.noSubs || []).map(([a, b]) => [sec(a), sec(b)]);
  const edits = (clip.edits || []).map(x => ({ ...x, at: sec(x.at) }));
  const kept = [...words, ...(clip.extraWords || [])].filter(w => !JUNK.test(w.w) && !mute.some(([a, b]) => w.s >= a && w.s < b));
  const edited = new Map();                         // each edit hits only the nearest word, not its neighbours
  for (const ed of edits) {
    let best = null;
    for (const w of kept) if (Math.abs(ed.at - w.s) <= 0.06 && (!best || Math.abs(ed.at - w.s) < Math.abs(ed.at - best.s))) best = w;
    if (best) edited.set(best, ed.w);
  }
  return kept
    .map(w => !edited.has(w) ? w : edited.get(w) ? { ...w, w: edited.get(w) } : null)
    .filter(Boolean)
    .map(w => {
      const key = w.w.trim().toLowerCase().replace(/[.,!?«»"]/g, '');
      if (!(key in rep)) return w;
      const tail = w.w.trim().match(/[.,!?]+$/)?.[0] || '';
      return rep[key] ? { ...w, w: rep[key] + tail } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.s - b.s);
}
function buildAss(clip, segs, total) {
  const lines = [];
  const all = clipWords(clip);
  for (const s of segs) {
    if (s.kind !== 'main') continue;
    const ws = all.filter(w => w.s >= s.from - 0.05 && w.e <= s.to + 0.05);
    const chunks = chunkWords(ws);
    chunks.forEach((ch, ci) => {
      const disp = displayLines(ch);                      // [[word, ...], [word, ...]?] without final . ,
      const nextChunk = chunks[ci + 1];
      ch.forEach((w, i) => {
        const start = s.outStart + (w.s - s.from);
        // keep the last word lit until the next chunk if the pause is short
        const tailEnd = nextChunk && nextChunk[0].s - w.e < 0.7 ? nextChunk[0].s : w.e + 0.3;
        const nextS = i + 1 < ch.length ? ch[i + 1].s : tailEnd;
        const end = s.outStart + (Math.min(nextS, s.to) - s.from);
        let k = 0;
        const text = disp.map(line => line.map(word => {
          const t = word.toUpperCase().replace(/[{}\\]/g, '');
          return k++ === i ? `{\\c&H${bgr(BRAND.green)}&\\fscx110\\fscy110}${t}{\\c&HFFFFFF&\\fscx100\\fscy100}` : t;
        }).join(' ')).join('\\N');
        if (end > start) lines.push(`Dialogue: 0,${assTime(start)},${assTime(Math.min(end, total))},Cap,,0,0,0,,{\\an5\\pos(540,${SUB_Y})}${text}`);
      });
    });
  }
  // Hook title for the first 3 s: pink opaque box (BorderStyle 3), long hooks wrap into two balanced lines.
  if (clip.hook) {
    const hw = clip.hook.toUpperCase().replace(/[{}\\]/g, '').split(/\s+/);
    let hookText = hw.join(' ');
    if (hookText.length > 18 && hw.length > 1) {
      let best = 1, bestCost = Infinity;
      for (let i = 1; i < hw.length; i++) { const c = Math.max(hw.slice(0, i).join(' ').length, hw.slice(i).join(' ').length); if (c < bestCost) { bestCost = c; best = i; } }
      hookText = hw.slice(0, best).join(' ') + '\\N' + hw.slice(best).join(' ');
    }
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(3, total))},Hook,,0,0,0,,{\\an5\\pos(540,${HOOK_Y})\\fad(0,400)}${hookText}`);
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n[V4+ Styles]\n` +
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
    `Style: Cap,Arial Black,72,&H00FFFFFF,&H00FFFFFF,&H00${bgr(BRAND.dark)},&H80000000,0,0,0,0,100,100,0,0,1,7,3,5,60,60,0,1\n` +
    `Style: Hook,Arial Black,66,&H00FFFFFF,&H00FFFFFF,&H00${bgr(BRAND.pink)},&H00${bgr(BRAND.pink)},0,0,0,0,100,100,0,0,3,22,0,5,60,60,0,1\n\n` +
    '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
    lines.join('\n') + '\n';
}
const bgr = hex => hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2);

// ---------- per-segment video filters (effects version) ----------
// Effect windows in segment-local seconds; only those overlapping the segment are kept.
const windows = (list, s, defDur) => (list || [])
  .map(x => ({ ...x, a: sec(x.at) - s.from, b: sec(x.at) - s.from + (x.dur || defDur) }))
  .filter(x => x.b > 0 && x.a < s.to - s.from);
function zoomExpr(clip, s) {
  const terms = windows(clip.fx?.zooms, s, 1.5).map(({ a, b, z }) => {
    const k = ((z || 1.25) - 1).toFixed(3), A = a.toFixed(2), B = b.toFixed(2);
    return `if(between(it,${A},${B}),${k}*min(1,min((it-${A})/0.25,(${B}-it)/0.25)),0)`;
  });
  return terms.length ? `1+${terms.join('+')}` : null;
}
function focusY(clip) { return clip.fx?.focus === 'game' ? GAME_Y : FACE_Y; }
function shakeExpr(clip, s, axis) {
  const terms = windows(clip.fx?.shake, s, 0.8).map(({ a, b }) =>
    `if(between(t,${a.toFixed(2)},${b.toFixed(2)}),${axis === 'x' ? 18 : 14}*sin(t*${axis === 'x' ? 71 : 53}),0)`);
  return terms.length ? terms.join('+') : null;
}

async function renderClip(clip, withFx, sfxDir) {
  const work = path.join(outDir, 'tmp', `${clip.id}_${withFx ? 'fx' : 'plain'}`);
  fs.mkdirSync(work, { recursive: true });
  fs.copyFileSync(FONT_SRC, path.join(work, FONT));
  const { segs, total } = buildSegments(clip, withFx);
  const inputs = [], vf = [], af = [], labels = [];
  // inputs + per-segment chains
  for (const [i, s] of segs.entries()) {
    if (s.kind === 'ff') {
      const n = ffFrames(s), dir = path.join(work, `ff${i}`);
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(path.join(dir, `f${String(n).padStart(4, '0')}.jpg`))) {
        await run(['-skip_frame', 'nokey', '-ss', String(s.from), '-t', String(s.to - s.from), '-i', spec.source,
          '-vf', `fps=${n}/${(s.to - s.from).toFixed(2)},scale=${W}:${H}`, '-vframes', String(n), '-q:v', '3', path.join(dir, 'f%04d.jpg')]);
      }
      inputs.push('-framerate', String(FPS), '-i', path.join(dir, 'f%04d.jpg'));
      const rate = (s.to - s.from) / (n / FPS);
      fs.writeFileSync(path.join(work, `ff${i}.txt`), `ПЕРЕМОТКА x${Math.round(rate)}`);
      vf.push(`[${inputs.filter(x => x === '-i').length - 1}:v]setsar=1,trim=end_frame=${n},setpts=PTS-STARTPTS,` +
        `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.25:t=fill,` +
        `drawtext=fontfile='${FONT}':textfile=ff${i}.txt:fontsize=64:fontcolor=#${BRAND.cyan}:borderw=6:bordercolor=#${BRAND.dark}:x=(w-tw)/2:y=820,` +
        `drawtext=fontfile='${FONT}':text='+%{eif\\:trunc(t*${rate.toFixed(3)}/60)\\:d}\\:%{eif\\:mod(trunc(t*${rate.toFixed(3)})\\,60)\\:d\\:2}':fontsize=150:fontcolor=white:borderw=8:bordercolor=#${BRAND.dark}:x=(w-tw)/2:y=920,` +
        `fade=t=in:st=0:d=0.15:color=white,setsar=1,format=yuv420p[v${i}]`);
      af.push(`aevalsrc='0.25*sin(2*PI*1900*t)*lt(mod(t\\,0.25)\\,0.02)':d=${(n / FPS).toFixed(3)}:s=48000,aformat=channel_layouts=stereo[a${i}]`);
    } else if (s.kind === 'still') {
      // freeze-frame: one source frame repeated, with the caption box and silence
      const n = Math.round(s.dur * FPS);
      inputs.push('-ss', s.from.toFixed(3), '-t', '0.5', '-i', spec.source);
      const idx = inputs.filter(x => x === '-i').length - 1;
      fs.writeFileSync(path.join(work, `fr${i}.txt`), clip.fx.freeze.text.toUpperCase());
      if (clip.fx.freeze.image) {
        // caption drawn elsewhere (browser fonts: nicknames keep their emoji and "font" letters): a 1080x1920 PNG laid over the frame
        inputs.push('-i', clip.fx.freeze.image);
        vf.push(`[${idx}:v]${SRC_SCALE}trim=end_frame=1,loop=loop=${n - 1}:size=1:start=0,setpts=N/${FPS}/TB,setsar=1[b${i}];` +
          `[b${i}][${idx + 1}:v]overlay=0:0,setsar=1,format=yuv420p[v${i}]`);
      } else
      vf.push(`[${idx}:v]${SRC_SCALE}trim=end_frame=1,loop=loop=${n - 1}:size=1:start=0,setpts=N/${FPS}/TB,setsar=1,` +
        `drawtext=fontfile='${FONT}':textfile=fr${i}.txt:fontsize=84:fontcolor=white:box=1:boxcolor=#${BRAND.pink}@0.92:boxborderw=28:x=(w-tw)/2:y=1050,` +
        `setsar=1,format=yuv420p[v${i}]`);
      af.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${s.dur}[a${i}]`);
    } else {
      const dur = s.to - s.from;
      inputs.push('-ss', s.from.toFixed(3), '-t', dur.toFixed(3), '-i', spec.source);
      const idx = inputs.filter(x => x === '-i').length - 1;
      let chain = `[${idx}:v]${SRC_SCALE}setsar=1,fps=${FPS},setpts=PTS-STARTPTS`;
      if (withFx) {
        const z = zoomExpr(clip, s);
        if (z) chain += `,zoompan=z='${z}':x='max(0,min(iw-iw/zoom,iw/2-iw/zoom/2))':y='max(0,min(ih-ih/zoom,${focusY(clip)}-ih/zoom/2))':d=1:s=${W}x${H}:fps=${FPS}`;
        const sx = shakeExpr(clip, s, 'x'), sy = shakeExpr(clip, s, 'y');
        if (sx) chain += `,scale=${W + 48}:${H + 84},crop=${W}:${H}:x='24+${sx}':y='42+${sy}'`;
        if (s.freeze) {
          chain += `,tpad=stop_mode=clone:stop_duration=${s.freeze}`;
          fs.writeFileSync(path.join(work, `fr${i}.txt`), clip.fx.freeze.text.toUpperCase());
          chain += `,drawtext=fontfile='${FONT}':textfile=fr${i}.txt:fontsize=84:fontcolor=white:box=1:boxcolor=#${BRAND.pink}@0.92:boxborderw=28:x=(w-tw)/2:y=1050:enable='gte(t,${dur.toFixed(2)})'`;
        }
        if (i > 0) chain += `,fade=t=in:st=0:d=0.15:color=white`;
      }
      vf.push(`${chain},setsar=1,format=yuv420p[v${i}]`);
      af.push(`[${idx}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo${s.freeze ? `,apad=pad_dur=${s.freeze}` : ''}[a${i}]`);
    }
    labels.push(`[v${i}][a${i}]`);
  }
  const fc = [...vf, ...af, `${labels.join('')}concat=n=${segs.length}:v=1:a=1[vc][ac]`];
  let vOut = '[vc]', aOut = '[ac]';
  if (withFx) {
    // subtitles, hook title, progress bar, end CTA
    fs.writeFileSync(path.join(work, 'subs.ass'), buildAss(clip, segs, total));
    fs.writeFileSync(path.join(work, 'hook.txt'), clip.hook.toUpperCase());
    fs.writeFileSync(path.join(work, 'cta1.txt'), 'ИГРАЙ СО МНОЙ В LIVE');
    fs.writeFileSync(path.join(work, 'cta2.txt'), 'угадай слово первым');
    const ctaAt = Math.max(0, total - 2.4).toFixed(2);
    // blur: [{ x, y, w, h, r? }] output-pixel boxes blurred for the whole clip (viewer nicknames we must not show)
    let vIn = '[vc]';
    if (clip.blur?.length) {
      fc.push(`[vc]split=${clip.blur.length + 1}[bb0]${clip.blur.map((_, j) => `[bs${j}]`).join('')}`);
      clip.blur.forEach((b, j) => {
        fc.push(`[bs${j}]crop=${b.w}:${b.h}:${b.x}:${b.y},boxblur=${b.r || 16}:2[bk${j}]`);
        fc.push(`${j ? `[bo${j - 1}]` : '[bb0]'}[bk${j}]overlay=${b.x}:${b.y}[bo${j}]`);
      });
      vIn = `[bo${clip.blur.length - 1}]`;
    }
    fc.push(`${vIn}subtitles=subs.ass:fontsdir=.,` +
      `drawbox=x=0:y=0:w='iw*t/${total.toFixed(3)}':h=12:color=#${BRAND.cyan}@0.95:t=fill,` +
      `drawtext=fontfile='${FONT}':textfile=cta1.txt:fontsize=70:fontcolor=#${BRAND.dark}:box=1:boxcolor=#${BRAND.green}@0.97:boxborderw=26:x=(w-tw)/2:y=${CTA_Y}:enable='gte(t,${ctaAt})',` +
      `drawtext=fontfile='${FONT}':textfile=cta2.txt:fontsize=52:fontcolor=white:borderw=5:bordercolor=#${BRAND.dark}:x=(w-tw)/2:y=${CTA_Y + 120}:enable='gte(t,${ctaAt})'[vo]`);
    vOut = '[vo]';
    const sfx = (clip.fx?.sfx || []).map(x => ({ ...x, out: x.atOut != null ? x.atOut : mapTime(segs, sec(x.at)) })).filter(x => x.out != null);
    segs.filter(s => s.kind === 'ff').forEach(s => sfx.push({ type: 'whoosh', out: s.outStart }));
    if (sfx.length) {
      const base = inputs.filter(x => x === '-i').length;
      sfx.forEach(x => inputs.push('-i', path.join(sfxDir, `${x.type}.wav`)));
      const mixIn = sfx.map((x, j) => { fc.push(`[${base + j}:a]adelay=${Math.round(x.out * 1000)}|${Math.round(x.out * 1000)}[s${j}]`); return `[s${j}]`; }).join('');
      fc.push(`[ac]${mixIn}amix=inputs=${sfx.length + 1}:normalize=0:duration=first[ao]`);
      aOut = '[ao]';
    }
  }
  fs.writeFileSync(path.join(work, 'graph.txt'), fc.join(';\n'));
  const out = path.join(outDir, `${clip.id}_${withFx ? 'fx' : 'plain'}.mp4`);
  await run([...inputs, '-filter_complex_script', 'graph.txt', '-map', vOut, '-map', aOut, '-t', total.toFixed(3), ...ENC, out], work);
  return { out, total };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const sfxDir = path.join(outDir, 'sfx');
  await makeSfx(sfxDir);
  for (const clip of spec.clips) {
    if (only.length && !only.includes(clip.id)) continue;
    for (const fx of WITH_PLAIN ? [false, true] : [true]) {
      const t0 = Date.now();
      try { const r = await renderClip(clip, fx, sfxDir); console.log(`${clip.id} ${fx ? 'fx   ' : 'plain'} ${r.total.toFixed(1)}s -> ${path.basename(r.out)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
      catch (e) { console.log(`${clip.id} ${fx ? 'fx' : 'plain'} FAILED: ${e.message}`); }
    }
  }
})();
