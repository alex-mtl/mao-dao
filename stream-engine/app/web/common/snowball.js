// Snowball (likes / a gift): a snowball with the viewer's avatar flies from a bottom corner at the streamer (the top
// third of the 9:16 frame, half the throws at the head), pops on the screen into a swarm of colored Lottie snowflakes
// and the viewer's name, whose letters then fly off upward. Works on every page (games + streamer overlay).
//   Snowball.throw({name, avatar, big, seed}, {sound: true})
// seed (from the engine) makes the flight and the burst the same on the room page's preview and the overlay.
window.Snowball = (() => {
  const clean = n => (n || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim() || '?';
  // where the streamer is: the top third of the frame (fractions of the window)
  const ZONE = { x0: .2, x1: .8, y0: .04, y1: .36 }, HEAD = { x: .5, y: .15 };
  // several at once (a combo of gifts): up to MAX_AIR in the air, GAP_MS apart, the rest wait
  const MAX_AIR = 4, GAP_MS = 350, MAX_QUEUE = 40, MAX_FLAKES = 140;
  let ready = false, sky = null, flakeJson = '', inAir = 0, lastStart = 0, flakes = 0;
  const queue = [], items = [];

  const CSS = `
  .sb-sky { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 1000; }
  .sb-ball { position: absolute; left: 0; top: 0; will-change: transform; }
  .sb-core { position: relative; width: 100%; height: 100%; border-radius: 50%;
             background: radial-gradient(circle at 34% 30%, #fff 0%, #f3f8ff 38%, #c9dcf2 72%, #9bbbe0 100%);
             box-shadow: inset -.12em -.16em .3em rgba(60,100,160,.45), 0 .2em .5em rgba(0,0,0,.35); }
  .sb-core::after { content: ''; position: absolute; inset: 8% 20% 62% 24%; border-radius: 50%;
                    background: radial-gradient(circle, rgba(255,255,255,.9), transparent 70%); }
  .sb-ava { position: absolute; left: 17%; top: 17%; width: 66%; height: 66%; border-radius: 50%; object-fit: cover;
            box-shadow: 0 0 0 .1em rgba(255,255,255,.95), 0 0 .25em .1em rgba(200,225,255,.9); }
  .sb-puff { position: absolute; left: 0; top: 0; border-radius: 50%;
             background: radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(230,244,255,.6) 40%, transparent 70%); }
  .sb-flake { position: absolute; left: 0; top: 0; will-change: transform, opacity; filter: drop-shadow(0 0 .12em rgba(255,255,255,.9)); }
  .sb-flake svg { display: block; }
  .sb-row { position: absolute; left: 0; top: 0; white-space: pre; visibility: hidden; }
  .sb-letter { position: absolute; left: 0; top: 0; will-change: transform, opacity; white-space: pre;
               -webkit-text-stroke: .07em #fff; paint-order: stroke fill; text-shadow: 0 .06em .14em rgba(0,0,0,.45); }
  .sb-row, .sb-letter { font: 900 var(--fs) 'Segoe UI', system-ui, sans-serif; line-height: 1; }`;

  function init() {
    if (ready) return;
    ready = true;
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    sky = document.createElement('div'); sky.className = 'sb-sky'; document.body.appendChild(sky);
    fetch(new URL('common/lottie/snowflake.json', document.baseURI)).then(r => r.text()).then(t => { flakeJson = t; })
      .catch(() => {});
    let last = performance.now();
    (function loop(now) {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      for (let i = items.length - 1; i >= 0; i--) if (!items[i](dt)) items.splice(i, 1);
      requestAnimationFrame(loop);
    })(last);
  }

  function rng(seed) {                                       // mulberry32: the same numbers for the same seed
    let a = (seed >>> 0) || Math.floor(Math.random() * 2 ** 31);
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
                   t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // colors as the balloons and butterflies: any hue, saturated pastel, blue / violet lifted
  function pick(r) {
    const h = window.Chroma ? Chroma.hue(Math.floor(r() * 360)) : Math.floor(r() * 360), s = 90 + r() * 10;
    const up = h >= 205 && h <= 295 ? 9 : (h >= 180 && h < 205) || (h > 295 && h <= 320) ? 4 : 0;
    return [h, s, 68 + up];
  }
  function rgb(h, s, l) {                                    // hsl -> [r, g, b] 0..1 for Lottie
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map(v => +v.toFixed(3));
  }
  const BLACK = '"c":{"a":0,"k":[0,0,0,1]';                   // the file's only color
  const flakeData = c => JSON.parse(flakeJson.split(BLACK).join(`"c":{"a":0,"k":[${c.join(',')},1]`));

  function avatarUrl(name) {                                 // no avatar: the first letter on a color of the name
    const h = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const ch = ([...name][0] || '?').toUpperCase().replace(/[<&>"]/g, '');
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
      <rect width="40" height="40" fill="hsl(${h} 70% 52%)"/><text x="20" y="27.5" font-family="Segoe UI,sans-serif"
      font-size="21" font-weight="800" text-anchor="middle" fill="#fff">${ch}</text></svg>`);
  }

  function fly(e, o) {
    const W = innerWidth, H = innerHeight, r = rng(e.seed), rnd = (a, b) => a + r() * (b - a);
    const name = clean(e.name), big = !!e.big, sound = o && o.sound && window.AudioKit && AudioKit.ready;
    const onHead = r() < .5;
    const tx = (onHead ? HEAD.x + rnd(-.06, .06) : rnd(ZONE.x0 + .05, ZONE.x1 - .05)) * W;
    const ty = (onHead ? HEAD.y + rnd(-.03, .03) : rnd(ZONE.y0 + .03, ZONE.y1 - .04)) * H;
    const fromLeft = r() < .5;                               // thrown from a bottom corner
    const sx = fromLeft ? rnd(-.05, .1) * W : rnd(.9, 1.05) * W, sy = H * rnd(.88, 1.02);
    const cx = (sx + tx) / 2 + (fromLeft ? -1 : 1) * W * .1, cy = ty - H * rnd(.06, .12);
    const size = Math.min(W, H * .5625) * (big ? .2 : .14), dur = rnd(.75, .9);
    const el = document.createElement('div'); el.className = 'sb-ball';
    el.style.width = el.style.height = size + 'px'; el.style.fontSize = size / 3 + 'px';
    el.innerHTML = '<div class="sb-core"><img class="sb-ava" alt=""></div>';
    const img = el.querySelector('img');
    img.onerror = () => { img.onerror = null; img.src = avatarUrl(name); };
    img.src = e.avatar || avatarUrl(name);
    sky.appendChild(el);
    if (sound) AudioKit.noise(0, .35, .06, 1800);            // whoosh
    let t = 0;
    items.push(dt => {
      t += dt; const p = Math.min(1, t / dur), q = 1 - p;
      const x = q * q * sx + 2 * q * p * cx + p * p * tx, y = q * q * sy + 2 * q * p * cy + p * p * ty;
      el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) scale(${1.6 - .75 * p}) rotate(${p * (fromLeft ? 360 : -360)}deg)`;
      if (p < 1) return true;
      el.remove(); inAir--; next();
      if (sound) AudioKit.snow((tx / W) * 1.2 - .6, big);    // the clap and the chime, as the flakes burst
      burst(tx, ty, size * .85, big, r, W, H); letters(tx, ty, name, r, W, H);
      return false;
    });
  }

  function burst(x, y, size, big, r, W, H) {
    const rnd = (a, b) => a + r() * (b - a);
    const puff = document.createElement('div'); puff.className = 'sb-puff'; sky.appendChild(puff);
    let tp = 0;
    items.push(dt => {
      tp += dt; const p = Math.min(1, tp / .45), rad = size * (.6 + 1.6 * p);
      puff.style.width = puff.style.height = 2 * rad + 'px';
      puff.style.transform = `translate(${x - rad}px, ${y - rad}px)`; puff.style.opacity = 1 - p;
      if (p < 1) return true; puff.remove(); return false;
    });
    if (!flakeJson || !window.lottie) return;
    const n = Math.min(big ? 26 : 14, MAX_FLAKES - flakes), base = H * 2.5 / 16;   // a size-1 flake: 2.5/16 of the height
    for (let i = 0; i < n; i++) {
      const w = base * rnd(.5, 1.3);                         // 0.5 - 1.3 of the normal size
      const el = document.createElement('div'); el.className = 'sb-flake';
      el.style.width = el.style.height = w + 'px'; sky.appendChild(el); flakes++;
      const anim = lottie.loadAnimation({ container: el, renderer: 'svg', loop: false, autoplay: false,
                                          animationData: flakeData(rgb(...pick(r))) });
      // the flake grows 0 -> full in frames 0-86 of the file: a fast pop-in out of the snowball, then still (we spin it)
      anim.setSpeed(4); anim.playSegments([15, 86], true);
      // straight rays, the speed falls off (drag): pos = v0 / k * (1 - e^-kt); an even spin
      const a = (i / n) * Math.PI * 2 + rnd(-.25, .25), v0 = rnd(.5, 1.1) * H * (big ? .95 : .7), drag = rnd(1.6, 2.2);
      const spin = rnd(120, 260) * (r() < .5 ? -1 : 1), life = rnd(2.4, 3.2), rot0 = rnd(0, 360);
      let t = 0;
      items.push(dt => {
        t += dt; const d = v0 / drag * (1 - Math.exp(-drag * t));
        el.style.transform = `translate(${x + Math.cos(a) * d - w / 2}px, ${y + Math.sin(a) * d - w / 2}px) rotate(${rot0 + spin * t}deg)`;
        el.style.opacity = t > life - .8 ? Math.max(0, (life - t) / .8) : 1;
        if (t < life) return true; anim.destroy(); el.remove(); flakes--; return false;
      });
    }
  }

  // the name pops up at the hit letter by letter, holds, then the letters fly off upward (straight, slowing, spinning)
  function letters(x, y, name, r, W, H) {
    const rnd = (a, b) => a + r() * (b - a), fs = H * .052, chars = [...name];
    const row = document.createElement('div'); row.className = 'sb-row'; row.style.setProperty('--fs', fs + 'px');
    chars.forEach(c => { const s = document.createElement('span'); s.textContent = c; row.appendChild(s); });
    sky.appendChild(row);
    const total = row.offsetWidth, x0 = Math.max(fs * .3, Math.min(W - total - fs * .3, x - total / 2));
    const y0 = Math.max(fs * .3, y - fs * 1.2);
    [...row.children].forEach((span, i) => {
      const c = chars[i]; if (!c.trim()) return;
      const lx = x0 + span.offsetLeft, lw = span.offsetWidth, [h, s, l] = pick(r);
      const el = document.createElement('div'); el.className = 'sb-letter'; el.textContent = c;
      el.style.setProperty('--fs', fs + 'px'); el.style.color = `hsl(${h} ${s}% ${l - 6}%)`;
      el.style.transformOrigin = `${lw / 2}px ${fs / 2}px`; sky.appendChild(el);
      const a = -Math.PI / 2 + rnd(-.75, .75), v0 = rnd(.45, .8) * H, drag = rnd(1.5, 2), spin = rnd(120, 280) * (r() < .5 ? -1 : 1);
      const pop = .03 * i, hold = .75 + .035 * i, life = hold + rnd(1.3, 1.7);
      let t = 0;
      items.push(dt => {
        t += dt;
        let px = lx, py = y0, rot = 0, sc = 1;
        if (t < pop + .22) { const p = Math.max(0, (t - pop) / .22); sc = p < .7 ? p / .7 * 1.25 : 1.25 - (p - .7) / .3 * .25; }
        if (t > hold) {
          const tt = t - hold, d = v0 / drag * (1 - Math.exp(-drag * tt));
          px += Math.cos(a) * d; py += Math.sin(a) * d; rot = spin * tt;
        }
        el.style.transform = `translate(${px}px, ${py}px) rotate(${rot}deg) scale(${sc})`;
        el.style.opacity = t > life - .6 ? Math.max(0, (life - t) / .6) : 1;
        if (t < life) return true; el.remove(); return false;
      });
    });
    row.remove();
  }

  function next() {
    if (!queue.length || inAir >= MAX_AIR) return;
    const wait = lastStart + GAP_MS - Date.now();
    if (wait > 0) { clearTimeout(next.t); next.t = setTimeout(next, wait); return; }
    const [e, o] = queue.shift();
    inAir++; lastStart = Date.now();
    fly(e, o);
    next();
  }

  return {
    throw(e, o) {
      init();
      if (queue.length >= MAX_QUEUE) return;
      queue.push([e || {}, o]); next();
    },
  };
})();
