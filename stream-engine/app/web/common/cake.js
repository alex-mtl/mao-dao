// Cake show (a party for the whole stream): a three-tier cake rises from the bottom edge (90% / 60% / 30% of the
// width), a gift box above it tips over and pours 100 firecrackers on sticks - 50 / 35 / 15 stick into the bottom /
// middle / top tier at random angles. The tiers turn (one way, the other way) with everything on them - frosting
// drips, sprinkles, pearls, the hearts and butterflies glued on the sides - so half of the crackers hide behind the
// cake. Then every fuse sparkles like a tiny sparkler and one cracker takes off each second, bursting into small hearts
// and butterflies in our colors; each "огонь" comment launches one more at once while the clock goes on - at most
// 100 s for all of them, the faster the more the chat fires. A cracker takes its stick along. When all are gone the
// cake turns its top to us, the avatar of the one the cake is for printed over the whole top tier, and then
// it falls apart into 18 slices flying off the screen.
// The cake is drawn here (no Lottie): round tiers seen a bit from above, so the turning is visible on the cake itself.
//   Cake.show(feedEvent, {sound, root}), Cake.start({root, sound, seed, hero, onEnd}), Cake.comment({name, text}), Cake.fire({name}), Cake.sound(on), Cake.info(), Cake.stop()
window.Cake = (() => {
  // per tier: crackers, width (share of the frame), side height (share of the height), turn direction and speed, rows
  // of sticks on the top (share of the radius - the lower tiers keep the middle for the tier above), the hearts and
  // butterflies on the side (count, size as a share of the side), sprinkles, pearls at the foot, drips, scallops, colors
  const TIERS = [
    { n: 50, w: .9, h: .15, dir: 1, spin: 1, rows: [.8, .94], decor: 12, deco: .34, sprinkles: 70, ring: .7, pearls: 44, drips: 16, scal: 14,
      body: '#ff8e94', bodyDark: '#e8707a', cap: '#feb2bb', top: '#ffd6db' },
    { n: 35, w: .6, h: .125, dir: -1, spin: 1.3, rows: [.66, .9], decor: 10, deco: .34, sprinkles: 45, ring: .55, pearls: 32, drips: 12, scal: 10,
      body: '#db6c64', bodyDark: '#bf534d', cap: '#dc2551', top: '#f2507a' },
    { n: 15, w: .3, h: .095, dir: 1, spin: 1.7, rows: [.62], decor: 6, deco: .38, sprinkles: 26, ring: .3, pearls: 20, drips: 8, scal: 8,
      body: '#ff8e94', bodyDark: '#e8707a', cap: '#feb2bb', top: '#ffd6db' },
  ];
  const TILT = .3;                                           // how much of the top we see: ry = R * tilt
  const F_TURN = 1.2, F_HOLD = 1.5, F_FLY = 1.3, SLICES = 18;  // the finale: turn top up, show the avatar, fly apart
  const WAVES = 3, WAVE_GAP = .1;                            // the slices go in 3 waves, .1 s apart
  const T_TIER = [0, .5, 1, 1.45];                           // when the tiers and the candle pop in, s
  const T_BOX = 2.3, T_POUR = 3.4, POUR = 4.5;               // the box drops in, tips over, pours for POUR s
  const GAP = 1, MAX_PARTS = 1400, MAX_SPARKS = 900;
  const WORDS = ['огонь', 'fire', 'feu', 'fuego'];  // the chat command, in our 4 languages
  const QUEUE = 3, shows = [];                               // cake shows waiting for the one playing
  const STICK = '#e9cf9f', HUES = 24, N = 40;                // N: points along the visible half of a tier's edge

  let css = false, gen = 0;
  let root, stage, cv, x, W = 0, H = 0, dpr = 1, S = 1;
  const W0 = 400;                                            // sprites are drawn for a 400 px wide frame, S scales them
  let r = Math.random, geo = [], phi = [0, 0, 0], omega = 0, pre = [1, 0, 0], tilt = TILT, lift = 0;
  let finAt = 0, fin = 0, fans = new Map(), hero = null, slices = null, cut = null;
  let T = 0, running = false, petards = [], decor = [], sprinkles = [], parts = [], sparks = [], rockets = [], labels = [];
  let landed = 0, litAt = 0, nextAt = 0, waiting = [], waitAt = 0, opts = {}, soundAt = 0, whistleAt = 0, raf = 0;
  const heart = [], bfly = [];
  let glow = null, pearl = null, ready = false;

  const CSS = `
  .ck-stage { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 1000; }
  .ck-stage.fixed { position: fixed; }
  .ck-stage canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }`;

  function rng(seed) {                                       // mulberry32, as in snowball.js
    let a = (seed >>> 0) || Math.floor(Math.random() * 2 ** 31);
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
                   t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const rnd = (a, b) => a + r() * (b - a);
  // our colors (the balloons, butterflies, snowflakes): any hue, no green in chroma key mode
  const hue = () => window.Chroma ? Chroma.hue(Math.floor(r() * 360)) : Math.floor(r() * 360);
  const bucket = h => Math.round(h / (360 / HUES)) % HUES;
  const lit = h => (h >= 205 && h <= 295 ? 9 : 0);           // blue / violet lifted, as the balloons
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  // ---------- sprites, drawn once ----------
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const HEART = 'M32 57 C 12 42, 3 30, 7 18 C 11 7, 26 5, 32 17 C 38 5, 53 7, 57 18 C 61 30, 52 42, 32 57 Z';
  const WING_UP = 'M100 74 C 70 -6, -4 0, 12 62 C 22 98, 74 96, 100 84 Z';
  const WING_LOW = 'M100 88 C 72 96, 26 112, 40 148 C 56 166, 94 134, 100 98 Z';
  function sprites() {
    for (let i = 0; i < HUES; i++) {
      const h = i * 360 / HUES, h2 = (h + 50) % 360, L = 66 + lit(h);
      let c = canvas(64, 64), x = c.getContext('2d');
      let g = x.createRadialGradient(24, 22, 2, 32, 32, 34);
      g.addColorStop(0, `hsl(${h} 100% 90%)`); g.addColorStop(.45, `hsl(${h} 95% ${L}%)`); g.addColorStop(1, `hsl(${h} 90% ${L - 16}%)`);
      const hp = new Path2D(HEART);
      x.fillStyle = g; x.fill(hp); x.lineWidth = 3.5; x.strokeStyle = '#fff'; x.stroke(hp);
      x.fillStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.ellipse(21, 20, 6, 3.5, -.6, 0, 7); x.fill();
      heart.push(c);
      c = canvas(64, 52); x = c.getContext('2d'); x.scale(.32, .32);
      const up = new Path2D(WING_UP), low = new Path2D(WING_LOW);
      const wing = (p, a, b) => {
        g = x.createRadialGradient(40, 40, 6, 60, 70, 110);
        g.addColorStop(0, `hsl(${a} 100% 88%)`); g.addColorStop(.55, `hsl(${a} 95% ${L}%)`); g.addColorStop(1, `hsl(${b} 90% 56%)`);
        x.fillStyle = g; x.fill(p); x.lineWidth = 5; x.strokeStyle = '#fff'; x.stroke(p);
      };
      for (const m of [1, -1]) {
        x.save(); if (m < 0) { x.translate(200, 0); x.scale(-1, 1); }
        wing(up, h, h2); wing(low, h2, h);
        x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.arc(48, 44, 10, 0, 7); x.fill();
        x.restore();
      }
      x.fillStyle = `hsl(${h2} 80% 40%)`; x.strokeStyle = '#fff'; x.lineWidth = 4;
      x.beginPath(); x.ellipse(100, 92, 9, 44, 0, 0, 7); x.fill(); x.stroke();
      x.strokeStyle = `hsl(${h2} 80% 45%)`; x.lineWidth = 5; x.lineCap = 'round';
      x.beginPath(); x.moveTo(96, 50); x.quadraticCurveTo(86, 16, 72, 8); x.moveTo(104, 50); x.quadraticCurveTo(114, 16, 128, 8); x.stroke();
      bfly.push(c);
    }
    glow = canvas(32, 32); let x = glow.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(.25, 'rgba(255,210,120,.9)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    pearl = canvas(32, 32); x = pearl.getContext('2d'); g = x.createRadialGradient(12, 11, 1, 16, 16, 15);
    g.addColorStop(0, '#fff'); g.addColorStop(.5, '#fff1f4'); g.addColorStop(1, '#e7a9b9');
    x.fillStyle = g; x.beginPath(); x.arc(16, 16, 15, 0, 7); x.fill();
  }

  // a firecracker: a striped tube with a golden cone, its fuse at the bottom; the stick is drawn apart (it stays)
  const PET = { stick: .108, body: .126, cone: .05, w: .048 };    // shares of the width
  function petSprite(h) {
    const k = 2, bw = PET.w * W0, bl = PET.body * W0, cl = PET.cone * W0, c = canvas(Math.ceil((bw + 2) * k), Math.ceil((bl + cl + 1) * k));
    const x = c.getContext('2d'); x.scale(k, k); x.translate(1, 0);
    const L = 58 + lit(h), g = x.createLinearGradient(0, 0, bw, 0);
    g.addColorStop(0, `hsl(${h} 85% ${L - 22}%)`); g.addColorStop(.35, `hsl(${h} 100% ${L + 14}%)`); g.addColorStop(1, `hsl(${h} 85% ${L - 26}%)`);
    x.fillStyle = g; x.beginPath(); x.roundRect(0, cl, bw, bl, bw * .2); x.fill();
    x.fillStyle = 'rgba(255,255,255,.85)';
    for (const f of [.25, .62]) x.fillRect(0, cl + bl * f, bw, bl * .1);
    const gc = x.createLinearGradient(0, 0, bw, 0);
    gc.addColorStop(0, '#d9932a'); gc.addColorStop(.4, '#ffe58a'); gc.addColorStop(1, '#c47a18');
    x.fillStyle = gc; x.beginPath(); x.moveTo(-.4, cl + .5); x.lineTo(bw / 2, 0); x.lineTo(bw + .4, cl + .5); x.fill();
    c.w = bw + 2; c.h = bl + cl + 1;                          // logical size (for a W0 wide frame)
    return c;
  }

  // ---------- the cake: round tiers, each one a side band + a top ellipse ----------
  function layout() {
    const rc = root.getBoundingClientRect();
    if (!rc.width || !rc.height) return;                     // hidden: lay out when it shows
    W = rc.width; H = rc.height; S = W / W0; dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    place();
  }
  // the tiers for the current view: seen from above the walls get shorter (from the top, none); lift moves the cake
  // from the bottom edge to the middle of the frame
  function place() {
    const sk = Math.sqrt(Math.max(0, 1 - tilt * tilt));
    let cy = 0;
    TIERS.forEach((t, k) => {
      const R = t.w * W / 2, ry = R * tilt, hh = t.h * H * sk;
      // the bottom tier stands on the frame's bottom edge, every other one on the middle of the tier below
      if (k) cy -= hh; else { const c0 = H - hh - ry - H * .004; cy = c0 + (H * .5 - c0) * lift; }
      geo[k] = { cx: W / 2, cy, R, rx: R, ry, hh, capH: hh * .26 };
    });
  }

  // the cake turns under the screen: a point at the cake's angle th is seen at the screen angle a = th + phi
  // (a = 0 faces us). edge() walks the visible half of a tier from the left to the right, off(th) below its top rim
  function edge(g, f, off, back) {
    for (let i = 0; i <= N; i++) {
      const a = -Math.PI / 2 + Math.PI * (back ? N - i : i) / N;
      x.lineTo(g.cx + g.R * Math.sin(a), g.cy + g.ry * Math.cos(a) + off(wrap(a - f)));
    }
  }
  const zero = () => 0;
  function side(g) {                                         // the side seen from the front: rim, walls, bottom curve
    x.beginPath(); x.moveTo(g.cx - g.R, g.cy); x.lineTo(g.cx - g.R, g.cy + g.hh);
    x.ellipse(g.cx, g.cy + g.hh, g.R, g.ry, 0, Math.PI, 0, true);
    x.lineTo(g.cx + g.R, g.cy); x.ellipse(g.cx, g.cy, g.R, g.ry, 0, 0, Math.PI, false); x.closePath();
  }
  function base() { x.setTransform(dpr * pre[0], 0, 0, dpr * pre[0], dpr * pre[1], dpr * pre[2]); }
  const backOut = p => p <= 0 ? 0 : p >= 1 ? 1 : 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
  // the pop-in: the bottom tier jumps up from below the edge, the others grow out of the tier below
  function appear(k) {
    const p = Math.min(1, (T - T_TIER[k]) / .7), e = backOut(p), g = geo[Math.min(k, 2)];
    if (p <= 0) return false;
    if (k === 0) pre = [1, 0, (1 - e) * (g.hh + g.ry * 2 + H * .05)];
    else { const ax = g.cx, ay = k === 3 ? g.cy : g.cy + g.hh; pre = [e, ax - ax * e, ay - ay * e]; }
    return true;
  }

  function drawTier(k) {
    const t = TIERS[k], g = geo[k], f = phi[k];
    base();
    // the walls, a little darker at the foot
    side(g);
    let gr = x.createLinearGradient(0, g.cy, 0, g.cy + g.hh + g.ry);
    gr.addColorStop(0, t.body); gr.addColorStop(1, t.bodyDark); x.fillStyle = gr; x.fill();
    // the hearts and butterflies glued on the wall: squeezed at the edges, they turn with the tier
    for (const o of decor) {
      if (o.k !== k) continue;
      const a = o.th + f, d = Math.cos(a);
      if (d < .04) continue;
      const img = o.kind ? bfly[o.h] : heart[o.h], sz = g.hh * t.deco * o.size, ih = sz * img.height / img.width;
      put(g.cx + g.R * Math.sin(a), g.cy + g.hh * (.74 + o.dy) + g.ry * d, 0, d, 1);
      x.drawImage(img, -sz / 2, -ih / 2, sz, ih);
    }
    base();
    // white frosting running down the walls from under the colored top
    x.beginPath(); x.moveTo(g.cx - g.R, g.cy);
    edge(g, f, th => g.capH + g.hh * .05 + drip(t, th) * g.hh); edge(g, f, zero, true);
    x.fillStyle = '#fff'; x.fill();
    // the colored frosting on top, scalloped edge
    x.beginPath(); x.moveTo(g.cx - g.R, g.cy);
    edge(g, f, th => g.capH * (.62 + .38 * Math.abs(Math.sin(t.scal * th / 2)))); edge(g, f, zero, true);
    x.fillStyle = t.cap; x.fill();
    // pearls along the foot
    for (let i = 0; i < t.pearls; i++) {
      const a = i / t.pearls * Math.PI * 2 + f, d = Math.cos(a);
      if (d < -.05) continue;
      const pr = g.hh * .07;
      x.drawImage(pearl, g.cx + g.R * .99 * Math.sin(a) - pr, g.cy + g.hh + g.ry * d - pr * 1.3, pr * 2, pr * 2);
    }
    // the light comes from the front-left: the walls round off into shadow at the sides
    side(g);
    gr = x.createLinearGradient(g.cx - g.R, 0, g.cx + g.R, 0);
    gr.addColorStop(0, 'rgba(60,0,30,.32)'); gr.addColorStop(.18, 'rgba(60,0,30,.06)'); gr.addColorStop(.36, 'rgba(255,255,255,.14)');
    gr.addColorStop(.55, 'rgba(255,255,255,0)'); gr.addColorStop(.85, 'rgba(60,0,30,.16)'); gr.addColorStop(1, 'rgba(60,0,30,.38)');
    x.fillStyle = gr; x.fill();
    // the top, lit from the front-left, with sprinkles turning on it
    x.beginPath(); x.ellipse(g.cx, g.cy, g.R, g.ry, 0, 0, Math.PI * 2);
    gr = x.createRadialGradient(g.cx - g.R * .3, g.cy - g.ry * .2, 0, g.cx, g.cy, g.R);
    gr.addColorStop(0, '#fff'); gr.addColorStop(.25, t.top); gr.addColorStop(1, t.cap); x.fillStyle = gr; x.fill();
    x.lineCap = 'round'; x.lineWidth = g.R * .025 + 1;
    for (const s of sprinkles) {
      if (s.k !== k) continue;
      const a = s.th + f, px = g.cx + s.r * g.R * Math.sin(a), py = g.cy + s.r * g.ry * Math.cos(a), o = s.o + a;
      const l = g.R * .035 + 1.5;
      x.strokeStyle = s.c; x.beginPath();
      x.moveTo(px - Math.cos(o) * l, py - Math.sin(o) * l * tilt); x.lineTo(px + Math.cos(o) * l, py + Math.sin(o) * l * tilt); x.stroke();
    }
  }
  // drips: rounded tongues of frosting at fixed places on the cake, 0..1 of the side's height
  function drip(t, th) {
    let m = 0;
    for (const d of t.dr) {
      const q = wrap(th - d.th) / d.w;
      if (q > -1 && q < 1) m = Math.max(m, d.len * Math.sqrt(1 - q * q));
    }
    return m;
  }

  const t2h = () => TIERS[2].h * H;

  // the finale's picture: the hero's avatar printed over the whole top tier, the name on the ring below
  function drawAvatar() {
    if (!hero || fin <= 0) return;
    const g = geo[2], a = Math.min(1, fin * 1.4);
    base(); x.globalAlpha = a;
    x.save(); x.beginPath(); x.ellipse(g.cx, g.cy, g.R * .93, g.ry * .93, 0, 0, Math.PI * 2); x.clip();
    if (hero.img.complete && hero.img.naturalWidth) x.drawImage(hero.img, g.cx - g.R * .93, g.cy - g.ry * .93, g.R * 1.86, g.ry * 1.86);
    x.restore(); base(); x.globalAlpha = a;
    x.lineWidth = g.R * .06; x.strokeStyle = '#fff'; x.beginPath(); x.ellipse(g.cx, g.cy, g.R * .93, g.ry * .93, 0, 0, Math.PI * 2); x.stroke();
    const m = geo[1], fs = Math.min(H * .036, (m.R - g.R) * .42);
    x.font = `900 ${fs}px 'Segoe UI', system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    const text = hero.n > 1 ? `${hero.name} 🔥×${hero.n}` : hero.name, ty = g.cy + (g.ry + m.ry) / 2;
    x.lineWidth = fs * .22; x.strokeStyle = '#fff'; x.strokeText(text, g.cx, ty);
    x.fillStyle = '#b3123f'; x.fillText(text, g.cx, ty);
    x.globalAlpha = 1; x.textBaseline = 'alphabetic';
  }
  function avatarUrl(name) {                                 // no avatar: the first letter on a color of the name
    const h = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const ch = ([...name][0] || '?').toUpperCase().replace(/[<&>"]/g, '');
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
      <rect width="40" height="40" fill="hsl(${h} 70% 52%)"/><text x="20" y="27.5" font-family="Segoe UI,sans-serif"
      font-size="21" font-weight="800" text-anchor="middle" fill="#fff">${ch}</text></svg>`);
  }
  // who gets printed: always the one the cake is for (start's hero, with his own "огонь" count); with no hero -
  // the one who fired most (the first of them on a tie)
  function pickHero() {
    const own = opts.hero && clean(opts.hero.name);
    let best = null;
    if (own) { const v = fans.get(own); best = { name: own, avatar: opts.hero.avatar || (v && v.avatar), n: v ? v.n : 0 }; }
    else for (const v of fans.values()) if (!best || v.n > best.n) best = v;
    best = best || (opts.hero && { name: '?', avatar: opts.hero.avatar, n: 0 });
    if (!best) return null;
    const img = new Image();
    img.onerror = () => { img.onerror = null; img.src = avatarUrl(best.name); };
    img.src = best.avatar || avatarUrl(best.name);
    return { ...best, img };
  }

  function drawCandle() {
    const g = geo[2], cw = g.R * .2, ch = t2h() * 1.3 * (1 - fin), bx = g.cx, by = g.cy, top = by - ch;
    if (ch <= 1) return;
    base();
    x.save(); x.beginPath(); x.rect(bx - cw / 2, top, cw, ch); x.ellipse(bx, by, cw / 2, cw / 2 * tilt, 0, 0, Math.PI); x.clip();
    let gr = x.createLinearGradient(bx - cw / 2, 0, bx + cw / 2, 0);
    gr.addColorStop(0, '#227f7a'); gr.addColorStop(.35, '#62d8d1'); gr.addColorStop(1, '#1e6f6b');
    x.fillStyle = gr; x.fillRect(bx - cw / 2, top, cw, ch + cw);
    // the spiral stripe: turning with the top tier it runs up the candle
    const sp = cw * 1.1, sh = ((phi[2] / (Math.PI * 2)) * sp % sp + sp) % sp;
    x.fillStyle = 'rgba(255,255,255,.8)';
    for (let y = top - sp * 2 + sh; y < by + sp; y += sp) {
      x.beginPath(); x.moveTo(bx - cw / 2, y + cw * .5); x.lineTo(bx + cw / 2, y); x.lineTo(bx + cw / 2, y + cw * .32); x.lineTo(bx - cw / 2, y + cw * .82); x.fill();
    }
    x.restore(); base();
    x.fillStyle = '#7fe3dc'; x.beginPath(); x.ellipse(bx, top, cw / 2, cw / 2 * tilt, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#5a3a2a'; x.lineWidth = cw * .1; x.beginPath(); x.moveTo(bx, top); x.lineTo(bx, top - cw * .35); x.stroke();
    // the flame flickers
    const fl = 1 + .08 * Math.sin(T * 23) + .05 * Math.sin(T * 37), fh = cw * 1.7 * fl, fw = cw * .55, fx = bx + Math.sin(T * 9) * cw * .05, fy = top - cw * .2;
    const flame = (s, c) => {
      x.fillStyle = c; x.beginPath(); x.moveTo(fx, fy - fh * s);
      x.bezierCurveTo(fx + fw * s, fy - fh * s * .45, fx + fw * s * .8, fy, fx, fy);
      x.bezierCurveTo(fx - fw * s * .8, fy, fx - fw * s, fy - fh * s * .45, fx, fy - fh * s); x.fill();
    };
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = .5;
    x.drawImage(glow, fx - fh * 1.2, fy - fh * 1.6, fh * 2.4, fh * 2.4);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    flame(1, '#f7931e'); flame(.6, '#ffc84a');
  }

  // ---------- the show ----------
  function setup() {
    const quota = [];
    TIERS.forEach((t, k) => {
      const slots = [];
      for (let i = 0; i < t.n; i++)
        slots.push({ th: (i + rnd(-.35, .35)) / t.n * Math.PI * 2, r: t.rows[i % t.rows.length] + rnd(-.03, .03), used: false });
      t.slots = slots;
      for (let i = 0; i < t.n; i++) quota.push(k);
      for (let i = 0; i < t.decor; i++)
        decor.push({ k, th: (i + rnd(-.15, .15)) / t.decor * Math.PI * 2, kind: i % 2, h: bucket(hue()), dy: rnd(-.04, .04), size: rnd(.85, 1.15) });
      for (let i = 0; i < t.sprinkles; i++)
        sprinkles.push({ k, th: r() * Math.PI * 2, r: rnd(t.ring + .04, .95), o: r() * Math.PI, c: `hsl(${hue()} 90% ${rnd(55, 70)}%)` });
      t.dr = [];
      for (let i = 0; i < t.drips; i++)
        t.dr.push({ th: (i + rnd(-.25, .25)) / t.drips * Math.PI * 2, w: Math.PI / t.drips * rnd(.45, .8), len: rnd(.08, .3) });
    });
    for (let i = quota.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [quota[i], quota[j]] = [quota[j], quota[i]]; }
    petards = quota.map((k, i) => {
      const h = hue();
      return { k, h, spr: petSprite(h), slot: null, st: 'wait', at: T_POUR + (i + rnd(0, .8)) / quota.length * POUR,
               lean: rnd(.08, .5), psi: rnd(-.6, .6), dur: rnd(1, 1.45), spin: rnd(4, 9) * (r() < .5 ? -1 : 1),
               arc: rnd(-.08, .08), fuse: 0, t: 0 };
    });
  }

  // where a stick stands now: its foot on the tier's top, the lean turns with the tier (outward on the sides)
  function at(p) {
    const g = geo[p.k], a = p.slot.th + phi[p.k], d = Math.cos(a);
    return { x: g.cx + p.slot.r * g.rx * Math.sin(a), y: g.cy + p.slot.r * g.ry * d, d,
             rot: p.lean * Math.sin(a + p.psi), sc: (.82 + .18 * (d + 1) / 2) * S };
  }
  // a falling cracker takes the free slot that will face us when it lands - all land in front, then turn away
  function spawn(p, box) {
    const t = TIERS[p.k], ahead = phi[p.k] + t.dir * t.spin * omega * p.dur;
    let best = null, bd = 9;
    for (const s of t.slots) if (!s.used) { const d = Math.abs(wrap(s.th + ahead)); if (d < bd) { bd = d; best = s; } }
    best.used = true; p.slot = best; p.st = 'fall'; p.t = 0;
    p.sx = box.x + rnd(-.06, .06) * W; p.sy = box.y; p.rot0 = rnd(-1, 1);
  }

  function box() {                                          // the gift box: drops in, tips over, shakes, flies off
    const end = T_POUR + POUR + .5;
    if (T < T_BOX || T > end + .8) return null;
    const bw = W * .3, bh = W * .22;
    let y = H * .11, rot = 0;
    if (T < T_BOX + .6) y = -bh + (y + bh) * backOut((T - T_BOX) / .6);
    if (T >= T_POUR - .6) rot = Math.PI * .88 * Math.min(1, (T - T_POUR + .6) / .6);
    if (T >= T_POUR && T < end) rot += Math.sin(T * 38) * .05;
    if (T > end) y -= (T - end) / .8 * (y + bh * 2);
    // the open top, turned down
    const mx = W / 2 + Math.sin(rot) * bh * .5, my = y - Math.cos(rot) * bh * .5;
    return { x: W / 2, y, rot, bw, bh, mx, my };
  }
  function drawBox(b) {
    put(b.x, b.y, b.rot, 1, 1);
    const g = x.createLinearGradient(-b.bw / 2, 0, b.bw / 2, 0);
    g.addColorStop(0, '#d23a78'); g.addColorStop(.4, '#ff6fa8'); g.addColorStop(1, '#b8255f');
    x.fillStyle = g; x.beginPath(); x.roundRect(-b.bw / 2, -b.bh / 2, b.bw, b.bh, b.bw * .05); x.fill();
    x.fillStyle = '#8a1440'; x.fillRect(-b.bw / 2, -b.bh / 2, b.bw, b.bh * .06);     // the dark inside of the rim
    x.fillStyle = '#ffd84a'; x.fillRect(-b.bw * .06, -b.bh / 2, b.bw * .12, b.bh);
    // the lid flaps, open
    x.fillStyle = '#ff86b6';
    x.beginPath(); x.moveTo(-b.bw / 2, -b.bh / 2); x.lineTo(-b.bw * .78, -b.bh * .78); x.lineTo(-b.bw * .2, -b.bh * .62); x.lineTo(-b.bw * .05, -b.bh / 2); x.fill();
    x.beginPath(); x.moveTo(b.bw / 2, -b.bh / 2); x.lineTo(b.bw * .78, -b.bh * .78); x.lineTo(b.bw * .2, -b.bh * .62); x.lineTo(b.bw * .05, -b.bh / 2); x.fill();
    x.drawImage(heart[bucket(48)], -b.bw * .16, -b.bh * .05, b.bw * .32, b.bw * .32);
  }

  function put(px, py, rot, sx, sy) {                        // a sprite's transform, inside the current pop-in (pre)
    const c = Math.cos(rot), s = Math.sin(rot), k = dpr * pre[0];
    x.setTransform(k * c * sx, k * s * sx, -k * s * sy, k * c * sy, dpr * (pre[1] + pre[0] * px), dpr * (pre[2] + pre[0] * py));
  }
  function drawPetard(p, q, stick = true, body = true) {
    put(q.x, q.y, q.rot, q.sc, q.sc);
    const ls = PET.stick * W0;
    if (stick) { x.fillStyle = STICK; x.fillRect(-W0 * .0065, -ls, W0 * .013, ls + 1); }
    if (body) x.drawImage(p.spr, -p.spr.w / 2, -ls - p.spr.h, p.spr.w, p.spr.h);
  }
  // the fuse point (at the tube's bottom, a bit to the side) on the screen
  function fusePoint(q) {
    const lx = PET.w * W0 * .55, ly = -PET.stick * W0 - 1, c = Math.cos(q.rot), s = Math.sin(q.rot);
    return [q.x + (lx * c - ly * s) * q.sc, q.y + (lx * s + ly * c) * q.sc];
  }
  // a group of sticks (one tier, one side of it), far ones first, then their tiny sparklers: a glow and a few rays
  function drawGroup(list) {
    const fuses = [];
    for (const [p, q] of list) {
      if (p.st === 'stuck' && p.t < .3) q.rot += Math.sin(p.t * 40) * .25 * Math.exp(-p.t * 9);   // the thud
      drawPetard(p, q);
      if (p.fuse && T >= p.fuse) fuses.push([...fusePoint(q), q.sc / S]);
    }
    if (!fuses.length) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalCompositeOperation = 'lighter';
    x.beginPath();
    for (const [fx, fy, k] of fuses) {
      const n = 3 + (r() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const a = r() * 6.283, l = rnd(4, 16) * S * k;
        x.moveTo(fx, fy); x.lineTo(fx + Math.cos(a) * l, fy + Math.sin(a) * l);
      }
    }
    x.lineWidth = 1.6 * S; x.strokeStyle = 'rgba(255,226,150,.95)'; x.stroke();
    for (const [fx, fy, k] of fuses) { const g = rnd(18, 28) * S * k; x.drawImage(glow, fx - g / 2, fy - g / 2, g, g); }
    x.globalCompositeOperation = 'source-over';
  }

  // ---------- launch, fireworks ----------
  function left() { return petards.filter(p => p.st === 'stuck').length; }
  function launch(name) {
    const stuck = petards.filter(p => p.st === 'stuck');
    if (!stuck.length) return false;
    const seen = stuck.filter(p => at(p).d > 0), pool = seen.length && r() < .7 ? seen : stuck;
    const p = pool[Math.floor(r() * pool.length)], q = at(p), ls = PET.stick * W0 * q.sc;
    p.st = 'gone';
    rockets.push({ p, x: q.x + Math.sin(q.rot) * ls, y: q.y - Math.cos(q.rot) * ls, head: q.rot, v: H * rnd(.3, .45), sc: q.sc,
                   back: q.d < 0, yEx: H * rnd(.06, .42), t: 0, name: name || '' });
    if (opts.sound && window.AudioKit && AudioKit.ready && performance.now() - whistleAt > 90) {   // a real whistle, common/sounds
      whistleAt = performance.now();
      AudioKit.shot(new URL(`common/sounds/whistle-${1 + Math.floor(r() * 3)}.mp3`, document.baseURI).href,
                    { vol: .4 / Math.sqrt(1 + rockets.length), rate: rnd(.9, 1.15), pan: q.x / W * 1.4 - .7 });
    }
    return true;
  }
  function spark(px, py, vx, vy, life, h, size, back) {
    if (sparks.length >= MAX_SPARKS) return;
    sparks.push({ x: px, y: py, vx, vy, t: 0, life, c: h == null ? '255,214,140' : null, h, s: size, back });
  }
  function burst(px, py, name) {
    const room = Math.max(0, MAX_PARTS - parts.length);
    const n = Math.min(room, Math.max(8, Math.round(rnd(18, 30) * Math.min(1, room / 700))));
    const shape = r() < .35, h0 = hue(), h1 = hue(), spd = H * rnd(.3, .42), size = W * .045;
    for (let i = 0; i < n; i++) {
      let vx, vy;
      if (shape) {                                           // the burst draws a big heart
        const t = i / n * Math.PI * 2, hx = 16 * Math.sin(t) ** 3,
              hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        vx = hx / 17 * spd; vy = hy / 17 * spd;
      } else { const a = (i + rnd(-.3, .3)) / n * Math.PI * 2, v = spd * rnd(.45, 1); vx = Math.cos(a) * v; vy = Math.sin(a) * v; }
      const hh = r() < .55 ? h0 : r() < .6 ? h1 : hue();
      parts.push({ x: px, y: py, vx, vy, kind: r() < .55 ? 0 : 1, h: bucket(hh), s: size * rnd(.45, 1.5), rot: rnd(-.4, .4),
                   spin: rnd(-2, 2), ph: rnd(0, 7), t: 0, life: rnd(1.9, 2.9), drag: rnd(1.8, 2.4) });
    }
    for (let i = 0; i < 18; i++) { const a = r() * 6.283, v = spd * rnd(.3, 1.2); spark(px, py, Math.cos(a) * v, Math.sin(a) * v, rnd(.4, .9), h0, rnd(1.2, 2.4) * S); }
    parts.push({ flash: true, x: px, y: py, t: 0, life: .35, s: W * .2, h: h0 });
    if (name) labels.push({ x: px, y: py - W * .07, text: name, t: 0, h: h0 });
    if (opts.sound && window.AudioKit && AudioKit.ready && performance.now() - soundAt > 140) {
      soundAt = performance.now(); AudioKit.party(px / W * 1.4 - .7, .28);
    }
  }

  // ---------- the frame loop ----------
  function step(dt) {
    T += dt;
    // the tiers turn: fast while the crackers rain (they spread all around), then calm
    const want = finAt ? 0 : T < T_BOX ? .25 : T < T_POUR + POUR + 1.5 ? 1.25 : .42;
    omega += (want - omega) * Math.min(1, dt * 1.5);
    TIERS.forEach((t, k) => { phi[k] += t.dir * t.spin * omega * dt; });

    const b = box();
    for (const p of petards) {
      if (p.st === 'wait' && b && T >= p.at) spawn(p, { x: b.mx, y: b.my });
      if (p.st === 'fall') {
        p.t += dt;
        if (p.t >= p.dur) { p.st = 'stuck'; p.t = 0; landed++; if (landed === petards.length) litAt = T + .4; }
      } else if (p.st === 'stuck') p.t += dt;
    }
    if (litAt && T >= litAt && !nextAt) {
      for (const p of petards) p.fuse = litAt + rnd(0, 1.2);
      nextAt = litAt + 1.8; waitAt = nextAt;
    }
    if (nextAt && T >= nextAt) { if (launch()) nextAt += GAP; else nextAt = Infinity; }
    if (nextAt && waiting.length && T >= waitAt) { launch(waiting.shift()); waitAt = T + .12; }

    for (let i = rockets.length - 1; i >= 0; i--) {
      const k = rockets[i];
      k.t += dt; k.v += H * 1.1 * dt; k.head += (0 - k.head) * Math.min(1, dt * 2.6) + Math.sin(k.t * 20) * .01;
      k.x += Math.sin(k.head) * k.v * dt; k.y -= Math.cos(k.head) * k.v * dt;
      if (k.back && k.y < geo[2].cy - t2h()) k.back = false;
      for (let j = 0; j < 2; j++)
        spark(k.x + rnd(-1, 1) * S, k.y, rnd(-.03, .03) * H - Math.sin(k.head) * H * .1, Math.cos(k.head) * H * .1 + rnd(0, .05) * H,
              rnd(.25, .55), null, rnd(.8, 1.8) * S, k.back);
      if (k.y <= k.yEx || k.t > 2.2) { rockets.splice(i, 1); burst(k.x, k.y, k.name); }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.t += dt;
      s.vx *= Math.exp(-2.5 * dt); s.vy = s.vy * Math.exp(-2.5 * dt) + H * .25 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.t >= s.life) sparks.splice(i, 1);
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const o = parts[i]; o.t += dt;
      if (!o.flash) {
        const f = Math.exp(-o.drag * dt);
        o.vx *= f; o.vy = o.vy * f + H * .05 * dt;
        o.x += o.vx * dt + (o.kind ? Math.sin(o.t * 3 + o.ph) * W * .06 * dt : 0); o.y += o.vy * dt; o.rot += o.spin * dt * .3;
      }
      if (o.t >= o.life) parts.splice(i, 1);
    }
    if (slices) for (const c of slices) { c.t += dt; const t = Math.max(0, c.t - c.wait); c.d = c.v * t + c.acc * t * t / 2; c.rot = c.spin * t; }
    for (let i = labels.length - 1; i >= 0; i--) if ((labels[i].t += dt) > 1.6) labels.splice(i, 1);

    // all gone: the finale - the cake turns its top to us and rises to the middle, the avatar shows, then slices fly
    if (nextAt === Infinity && !rockets.length && !finAt) { finAt = T + 1; hero = pickHero(); }
    if (finAt && T > finAt) {
      const tf = T - finAt, p = Math.min(1, tf / F_TURN), e = p * p * (3 - 2 * p);
      fin = e; tilt = TILT + (1 - TILT) * e; lift = e; place();
      if (tf > F_TURN + F_HOLD && !slices) split();
      if (slices && tf > F_TURN + F_HOLD + F_FLY) { stop(); if (opts.onEnd) opts.onEnd(); }
    }
  }

  function drawRockets(back) {
    for (const k of rockets) if (k.back === back) {
      const ls = PET.stick * W0 * k.sc;              // the stick's foot, behind the tube along the flight
      drawPetard(k.p, { x: k.x - Math.sin(k.head) * ls, y: k.y + Math.cos(k.head) * ls, rot: k.head, sc: k.sc });
    }
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalCompositeOperation = 'lighter';
    for (const s of sparks) {
      if (!!s.back !== back) continue;
      const a = 1 - s.t / s.life;
      x.fillStyle = s.c ? `rgba(${s.c},${a})` : `hsla(${s.h} 100% 75% / ${a})`;
      x.fillRect(s.x - s.s / 2, s.y - s.s / 2, s.s, s.s);
    }
    x.globalCompositeOperation = 'source-over';
  }

  // painter's order, far to near: rockets behind the cake; each tier, then the sticks on its far half (the tier above
  // hides them); the candle among the top's sticks; then the near halves, top tier first, the bottom one last
  function draw() {
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
    pre = [1, 0, 0];
    if (!slices) drawRockets(true);
    if (slices) { drawSlices(); drawRockets(false); drawParts(); return; }
    drawCake();
    // falling crackers: on their way to their slot, accelerating, tumbling into the lean
    for (const p of petards) if (p.st === 'fall') {
      const q = at(p), u = Math.min(1, p.t / p.dur);
      drawPetard(p, { x: p.sx + (q.x - p.sx) * u + Math.sin(Math.PI * u) * p.arc * W, y: p.sy + (q.y - p.sy) * u * u,
                      rot: q.rot + (p.rot0 + p.spin) * (1 - u) ** 2, sc: q.sc });
    }
    const b = box(); if (b) drawBox(b);
    drawRockets(false);
    drawParts();
  }
  function drawCake() {
    const far = [[], [], []], near = [[], [], []];
    for (const p of petards) if (p.st === 'stuck') { const q = at(p); (q.d < 0 ? far : near)[p.k].push([p, q]); }
    for (const l of [...far, ...near]) l.sort((a, b) => a[1].d - b[1].d);
    for (let k = 0; k < 3; k++) {
      if (!appear(k)) continue;
      drawTier(k); drawGroup(far[k]);
      if (k === 2) { drawAvatar(); if (appear(3)) drawCandle(); appear(2); drawGroup(near[2]); }
      pre = [1, 0, 0];
    }
    drawGroup(near[1]); drawGroup(near[0]);
  }
  // the cake (seen from the top now) is cut like a pie: SLICES wedges from the middle, each flies off along its middle
  // line, turning, faster and faster, out of the frame
  function split() {
    const off = canvas(cv.width, cv.height), keep = x;
    x = off.getContext('2d'); drawCake(); x = keep;
    cut = off; slices = [];
    const a0 = r() * Math.PI * 2;
    for (let i = 0; i < SLICES; i++)
      slices.push({ a0: a0 + i / SLICES * Math.PI * 2, a1: a0 + (i + 1) / SLICES * Math.PI * 2, v: W * rnd(.15, .35), acc: W * rnd(2, 3), wait: (i % WAVES) * WAVE_GAP,
                    spin: rnd(.6, 1.8) * (r() < .5 ? -1 : 1), t: 0, d: 0, rot: 0 });   // every 3rd slice in one wave
    if (opts.sound && window.AudioKit && AudioKit.ready) { AudioKit.noise(0, .5, .12, 600); AudioKit.party(0, .4); }
  }
  function drawSlices() {
    const g = geo[0], cx = g.cx * dpr, cy = g.cy * dpr, R = g.R * 1.05 * dpr;
    for (const c of slices) {
      const m = (c.a0 + c.a1) / 2, dx = Math.cos(m) * c.d * dpr, dy = Math.sin(m) * c.d * dpr;
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
      x.translate(cx + dx, cy + dy); x.rotate(c.rot); x.translate(-cx, -cy);
      x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, c.a0, c.a1); x.closePath(); x.clip();
      x.drawImage(cut, 0, 0);
      x.restore();
    }
  }
  function drawParts() {
    // the fireworks: hearts and butterflies (they flap and flutter)
    for (const o of parts) {
      const p = o.t / o.life;
      if (o.flash) {
        x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalCompositeOperation = 'lighter'; x.globalAlpha = 1 - p;
        const g = o.s * (.4 + p); x.drawImage(glow, o.x - g / 2, o.y - g / 2, g, g);
        x.globalCompositeOperation = 'source-over'; continue;
      }
      x.globalAlpha = p > .7 ? (1 - p) / .3 : 1;
      const pop = Math.min(1, o.t / .18), img = o.kind ? bfly[o.h] : heart[o.h];
      const sx = o.kind ? .3 + .7 * Math.abs(Math.cos(o.t * 11 + o.ph)) : 1;
      put(o.x, o.y, o.rot, o.s * sx * pop / img.width, o.s * pop / img.width);
      x.drawImage(img, -img.width / 2, -img.height / 2);
    }
    x.globalAlpha = 1;
    // who fired: the name at the burst
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.textAlign = 'center';
    x.font = `900 ${Math.round(H * .03)}px 'Segoe UI', system-ui, sans-serif`; x.lineJoin = 'round';
    for (const l of labels) {
      x.globalAlpha = l.t > 1.1 ? (1.6 - l.t) / .5 : Math.min(1, l.t / .15);
      const y = Math.max(H * .04, l.y - l.t * H * .02), half = x.measureText('🔥 ' + l.text).width / 2 + 4;
      const lx = Math.max(half, Math.min(W - half, l.x));   // the whole name inside the frame
      x.lineWidth = H * .006; x.strokeStyle = '#fff'; x.strokeText('🔥 ' + l.text, lx, y);
      x.fillStyle = `hsl(${l.h} 90% 45%)`; x.fillText('🔥 ' + l.text, lx, y);
    }
    x.globalAlpha = 1;
  }

  function stop() {
    running = false; cancelAnimationFrame(raf);
    if (stage) stage.remove();
    stage = null; geo = [];
  }

  const clean = n => (n || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 24);

  const api = {
    start(o = {}) {
      stop();
      const my = ++gen;                                      // a new start ends the old loop (no two clocks at once)
      opts = o; r = rng(o.seed);
      if (!css) { css = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
      if (!ready) { ready = true; sprites(); }
      root = o.root || document.body;
      stage = document.createElement('div'); stage.className = 'ck-stage' + (root === document.body ? ' fixed' : '');
      cv = document.createElement('canvas'); stage.appendChild(cv); root.appendChild(stage);
      x = cv.getContext('2d');
      W = H = 0; T = 0; phi = [0, 0, 0]; omega = 0; petards = []; decor = []; sprinkles = []; parts = []; sparks = []; rockets = []; labels = [];
      landed = 0; litAt = 0; nextAt = 0; waiting = []; waitAt = 0;
      tilt = TILT; lift = 0; finAt = 0; fin = 0; fans = new Map(); hero = null; slices = null; cut = null;
      setup(); layout();
      running = true;
      let last = performance.now();
      (function loop(now) {
        if (!running || my !== gen) return;
        const dt = Math.min(.05, (now - last) / 1000); last = now;
        if (root.clientWidth !== Math.round(W) || root.clientHeight !== Math.round(H)) layout();
        if (geo.length) { step(dt); if (running && my === gen) draw(); }
        raf = requestAnimationFrame(loop);
      })(last);
    },
    // a feed event {type: 'cake', name, avatar, seed} (a gift or the room page's "now"): the show for that viewer;
    // while one plays the next ones wait (at most QUEUE)
    show(e, o = {}) {
      const go = () => api.start({ root: o.root, sound: o.sound, seed: e.seed, hero: { name: e.name, avatar: e.avatar },
                                   onEnd: () => { const n = shows.shift(); if (n) n(); } });
      if (!running) go(); else if (shows.length < QUEUE) shows.push(go);
    },
    // a chat comment: "огонь" launches one cracker at once (one per comment, however many times it says it)
    comment(e) {
      const text = ((e && e.text) || '').toLowerCase().replace(/ё/g, 'е');
      if (WORDS.some(w => text.includes(w))) return api.fire(e);
      return false;
    },
    fire(e) {
      if (!running) return false;
      const name = clean(e && e.name);
      if (name && !finAt) { const v = fans.get(name) || { name, avatar: e.avatar, n: 0 }; v.n++; v.avatar = e.avatar || v.avatar; fans.set(name, v); }
      if (!nextAt) {                                         // not lit yet: they go first once the fuses burn
        if (waiting.length < petards.length) waiting.push(name);
        return true;
      }
      return launch(name);
    },
    info() {
      const n = running ? left() : 0;
      return { running, left: n, waiting: waiting.length, phase: !running ? 'off' : finAt ? 'final' : nextAt ? 'fire' : landed < petards.length ? 'pour' : 'lit' };
    },
    resize() { if (running) layout(); },
    sound(on) { opts.sound = !!on; },        // on / off while it plays
    stop,
  };
  return api;
})();
