// Anagram overlay. All user text goes through textContent (no HTML injection).
// The stream "chrome" (frame and chroma / TT modes, side tops, what the gifts do, toasts, ticker, clock) follows
// guess/guess.js: same settings, same look; the game part is the round's word, the answer line and the players' table.
(() => {
  const $ = id => document.getElementById(id);
  const A = AudioKit, t = I18N.t;
  const clean = n => (n || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim() || 'Someone';
  const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const streakP = n => ({ n, wins: I18N.n(n, 'win'), winsUp: I18N.n(n, 'win').toUpperCase() });
  let S = null;                                   // last state

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function avatar(name, url, cls) {
    const hue = [...(name || '?')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const fallback = () => {
      const d = el('span', 'av' + (cls ? ' ' + cls : ''), (clean(name)[0] || '?').toUpperCase());
      d.style.background = `hsl(${Chroma.hue(hue)} 90% 60%)`;   // no green in chroma key mode
      return d;
    };
    if (!url || !/^https:\/\//.test(url)) return fallback();
    const img = el('img', 'av' + (cls ? ' ' + cls : ''));
    img.referrerPolicy = 'no-referrer'; img.alt = ''; img.src = url;
    img.onerror = () => img.replaceWith(fallback());
    return img;
  }
  function fitText(node, text) {                  // a headline shrinks until it fits its container's width
    const parent = node.parentElement;
    node.textContent = text;
    node.style.fontSize = '';
    const avail = parent.clientWidth - 20;
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (avail > 0 && node.scrollWidth > avail && size > 8) { size *= 0.92; node.style.fontSize = size + 'px'; }
  }
  // a word letter by letter; marks: ok / miss / extra per letter (an answer), none = plain tiles
  function tiles(word, marks, cls) {
    const box = el('div', cls || 'w');
    [...word].forEach((c, i) => box.append(el('span', 't' + (marks && marks[i] !== 'ok' ? ' ' + marks[i] : ''), c)));
    return box;
  }
  // a word's ×N stops at ×3 (the engine's MAX_MULT): later repeats add 0.1 and the word just flashes; with the
  // multiplication off (a setting) every repeat adds 0.1 and ×N is the real number of namers
  const MAX_MULT = 3;
  const multOn = () => !S || S.mult !== false;
  const shownN = n => (multOn() ? Math.min(MAX_MULT, n) : n);
  const score = x => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  // points on a seven-segment display (like a fuel pump's): every digit an SVG, unlit segments dimly visible
  // a digit is W x 100, a segment K * 2 thick (extra bold), G apart from its neighbours
  const W = 66, K = 9, G = 2;
  const SEG = {
    a: [K + G, K, W - K - G, 'h'], g: [K + G, 50, W - K - G, 'h'], d: [K + G, 100 - K, W - K - G, 'h'],
    f: [K, K + G, 50 - G, 'v'], b: [W - K, K + G, 50 - G, 'v'], e: [K, 50 + G, 100 - K - G, 'v'], c: [W - K, 50 + G, 100 - K - G, 'v'],
  };
  const DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
  const segPoints = ([p, q, r, dir]) => dir === 'h'
    ? `${p},${q} ${p + K},${q - K} ${r - K},${q - K} ${r},${q} ${r - K},${q + K} ${p + K},${q + K}`
    : `${p},${q} ${p + K},${q + K} ${p + K},${r - K} ${p},${r} ${p - K},${r - K} ${p - K},${q + K}`;
  const NS = 'http://www.w3.org/2000/svg';
  // always 00.0: at least two digits before the point, one after; the leading zeros are grey
  function lcd(x) {
    const box = el('span', 'sc');
    const [whole, tenth] = Math.max(0, x).toFixed(1).split('.');
    const digits = whole.padStart(2, '0'), text = digits + '.' + tenth;
    const lead = digits.slice(0, -1).match(/^0*/)[0].length;  // zeros before the last whole digit
    [...text].forEach((ch, i) => {
      const svg = document.createElementNS(NS, 'svg');
      if (ch === '.') {
        svg.setAttribute('viewBox', '0 0 20 100'); svg.setAttribute('class', 'dot');
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', 10); c.setAttribute('cy', 100 - K); c.setAttribute('r', K); c.setAttribute('class', 'on');
        svg.append(c);
      } else {
        svg.setAttribute('viewBox', `0 0 ${W} 100`);
        const lit = DIGITS[+ch] || '';
        Object.entries(SEG).forEach(([k, s]) => {
          const p = document.createElementNS(NS, 'polygon');
          p.setAttribute('points', segPoints(s));
          p.setAttribute('class', lit.includes(k) ? (i < lead ? 'on lead' : 'on') : 'off');
          svg.append(p);
        });
      }
      box.append(svg);
    });
    return box;
  }

  // ------------------------------------------------------------ sounds and voice
  const FX = {
    ok(n) { A.tone(660, 0, 0.1, 'triangle', 0.12, 990); A.tone(990 + n * 40, 0.08, 0.16, 'sine', 0.12); },
    rep() { A.tone(784, 0, 0.12, 'square', 0.08); A.tone(1175, 0.1, 0.22, 'square', 0.08); },
    bad() { A.tone(200, 0, 0.18, 'sawtooth', 0.07, 150); },
    gift() { [1568, 2093, 2637, 3136].forEach((f, i) => A.tone(f, i * 0.05, 0.3, 'sine', 0.1)); },
    follow() { A.tone(880, 0, 0.15, 'sine', 0.12); A.tone(1320, 0.1, 0.25, 'sine', 0.12); },
    tick(n) { A.tone(n <= 3 ? 1200 : 900, 0, 0.08, 'square', 0.1); },
    count(go) { go ? A.tone(1320, 0, 0.45, 'square', 0.16) : A.tone(660, 0, 0.18, 'square', 0.14); },
    winner() {
      [[523, 0], [659, .15], [784, .3], [1047, .45]].forEach(([f, d]) => { A.tone(f, d, 0.35, 'square', 0.14); A.tone(f / 2, d, 0.35, 'triangle', 0.18); });
      [523, 659, 784, 1047].forEach(f => A.tone(f, 0.65, 1.5, 'sawtooth', 0.06));
      A.noise(0.65, 0.6, 0.25);
    },
    timeout() { A.tone(220, 0, 0.6, 'sawtooth', 0.15, 110); A.tone(233, 0, 0.6, 'square', 0.08, 116); },
    streak(n) { [392, 523, 659, 784, 1047].slice(0, Math.min(5, 2 + n)).forEach((f, i) => A.tone(f, i * 0.09, 0.4, 'sawtooth', 0.08)); },
    // the bonuses' animations
    rise() { A.tone(300, 0, 0.5, 'sine', 0.07, 900); },
    spin(d) { A.tone(220, 0, d, 'triangle', 0.06, 880); for (let i = 0; i < 6; i++) A.noise(i * d / 6, 0.12, 0.05, 1500); },
    ding() { A.tone(1319, 0, 0.5, 'sine', 0.14); A.tone(1760, 0.06, 0.6, 'sine', 0.1); A.tone(2637, 0.06, 0.4, 'triangle', 0.04); },
    whoosh() { A.noise(0, 0.35, 0.12, 600); },
    coin() { A.tone(988, 0, 0.08, 'square', 0.07); A.tone(1319, 0.07, 0.3, 'square', 0.07); },
    burst() { A.noise(0, 0.18, 0.35, 300); A.tone(140, 0, 0.2, 'sine', 0.25, 60); },
    plusN() { [784, 988, 1175].forEach((f, i) => A.tone(f, i * 0.06, 0.25, 'triangle', 0.1)); },
    x2() { [523, 659, 784, 1047].forEach((f, i) => { A.tone(f, i * 0.07, 0.4, 'sawtooth', 0.05); A.tone(f / 2, i * 0.07, 0.4, 'triangle', 0.1); }); },
  };
  let lastBlip = 0;
  function fx(kind, arg) {
    if (!A.ready) return;
    if (kind === 'ok' || kind === 'bad' || kind === 'rep') {   // don't machine-gun blips
      const now = performance.now(); if (now - lastBlip < 90) return; lastBlip = now;
    }
    FX[kind](arg);
  }
  function voice(id, text, prio, rate) {
    if (!A.ready || !Toasts.voice(id)) return;
    rate = Toasts.rate(id, rate);
    if (prio === 'urgent') A.say(text, { urgent: true, excited: true, rate });
    else if (prio === 'high' || !A.speaking) A.say(text, { excited: true, rate });
  }

  // ------------------------------------------------------------ toasts (big, queued) and small notes
  const queue = []; let showing = null, toastTimer = 0;
  const TOAST_STALE_MS = 2500, TOAST_MIN_MS = 800;
  function toast(head, sub, color, opts) {
    opts = opts || {};
    if (opts.id && !Toasts.show(opts.id)) return;
    if (queue.length >= 3) queue.splice(queue.findIndex(q => !q.important), 1);
    queue.push({ head, sub, color, id: opts.id, huge: opts.huge, important: opts.important, keep: opts.keep,
                 hold: opts.hold || 1.2, at: Date.now() });
    if (!showing) nextToast();
    else if (!showing.keep) {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(nextToast, Math.max(0, showing.shownAt + TOAST_MIN_MS - Date.now()));
    }
  }
  function nextToast() {
    clearTimeout(toastTimer);
    $('toast').replaceChildren();
    let item;
    while ((item = queue.shift()) && !item.keep && Date.now() - item.at > TOAST_STALE_MS) {}
    showing = item || null;
    if (!item) return;
    item.shownAt = Date.now();
    const c = el('div', 'tcard' + (item.huge ? ' huge' : ''));
    c.style.setProperty('--c', item.color);
    c.style.setProperty('--hold', item.hold + 's');
    c.append(el('div', 'h', item.head));
    if (item.sub) c.append(el('div', 's', item.sub));
    $('toast').replaceChildren(c);
    toastTimer = setTimeout(nextToast, (queue.length && !item.keep ? TOAST_MIN_MS : (item.hold + 0.4) * 1000));
  }
  function mini(text, cls, id) {
    if (id && !Toasts.show(id)) return;
    const m = el('div', 'mini ' + (cls || ''), text);
    const box = $('miniToasts');
    box.appendChild(m);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(() => m.remove(), 2900);
  }

  // ------------------------------------------------------------ the chat's pace (as in guess.js)
  // answers in the last PACE_WINDOW_MS -> heat 0 (calm, under PACE_CALM a second) .. 1 (busy, PACE_BUSY and more),
  // smoothed; every timing goes from its calm value to its busy one, so a busy chat sees everything at once
  const PACE_WINDOW_MS = 10000, PACE_CALM = 1, PACE_BUSY = 4;
  let paceTimes = [], heat = 0;
  const pace = (calm, busy) => calm + (busy - calm) * heat;
  setInterval(() => {
    const now = Date.now();
    paceTimes = paceTimes.filter(x => now - x < PACE_WINDOW_MS);
    const wps = paceTimes.length / (PACE_WINDOW_MS / 1000);
    heat += (Math.min(1, Math.max(0, (wps - PACE_CALM) / (PACE_BUSY - PACE_CALM))) - heat) * 0.3;
  }, 500);

  // ------------------------------------------------------------ the answer line
  // one answer at a time, shown for a while that follows the pace; at most TRY_WAIT wait their turn - older
  // ones don't queue up: a scoring one lands in the table right away (no flight), a rejected one is dropped
  const TRY_WAIT = 1;
  const tries = []; let trying = false;
  function pushTry(e) {
    paceTimes.push(Date.now());
    tries.push(Object.assign({ at: Date.now() }, e));
    if (!trying) nextTry();
  }
  function label(e) {
    if (e.kind === 'ok') return '+' + e.points;
    if (e.kind === 'rep') return e.points >= 1 ? '×' + e.n : '+' + score(e.points);
    if (e.kind === 'base') return t('a.base');
    if (e.kind === 'dict') return t('a.dict');
    if (e.kind === 'own') return t('a.own');
    const letters = kind => [...new Set([...e.word].filter((c, i) => e.marks[i] === kind))].join(', ');
    return letters('miss') ? t('a.miss', { l: letters('miss') }) : t('a.extra', { l: letters('extra') });
  }
  function nextTry() {
    while (tries.length > TRY_WAIT + 1) {
      const old = tries.shift();
      if (old.kind === 'ok' || old.kind === 'rep') land(old, null);
    }
    const e = tries.shift();
    trying = !!e;
    if (!e) return;
    const box = $('try');
    box.classList.remove('shake', 'fade');
    const tw = tiles(e.word, e.marks, 'tw');
    tw.style.setProperty('--tw', `calc(var(--u) * ${Math.min(5, 56 / (e.word.length * 1.12)).toFixed(2)})`);
    const left = el('div', 'side'), who = el('div', 'side who');
    left.append(tw, el('span', 'lab ' + e.kind, label(e)));
    who.append(avatar(e.name, e.avatar), el('span', '', clean(e.name)));
    const cur = el('div', 'cur'); cur.style.display = 'contents';
    cur.append(left, who);
    box.replaceChildren(cur);
    if (e.kind === 'bad') { box.classList.add('shake'); fx('bad'); }
    const ms = tries.length ? pace(550, 120) : pace(1100, 200);
    if (e.kind === 'ok' || e.kind === 'rep') {
      fx(e.kind, e.points);
      setTimeout(() => land(e, tw), ms * .55);
    }
    setTimeout(() => { if (!tries.length) box.classList.add('fade'); nextTry(); }, ms);
  }

  // ------------------------------------------------------------ the players' table
  // the state brings the table at once; a word just named waits there (hidden / with its old ×N) until it lands
  // from the answer line
  const held = new Map();                         // WORD -> {kind, n before}
  // a repeated word flashes with the one who named it last next to it (avatar + nick), 3 s (calm) .. 1 s (busy);
  // the author's own avatar stays as it is
  const namers = new Map();                       // WORD -> {name, avatar, at, until}
  function hold(e) {
    if (e.kind === 'ok' && e.first) addAdj(e.uid, -e.points);   // its points come with the x2 animation
    if (e.kind === 'ok') held.set(e.word, { kind: 'ok' });
    else if (e.kind === 'rep' && shownN(e.n) !== shownN(e.n - 1)) held.set(e.word, { kind: 'rep', n: e.n - 1 });
  }
  function land(e, from) {
    held.delete(e.word);
    if (e.kind === 'rep') namers.set(e.word, { name: clean(e.name), avatar: e.avatar, at: Date.now(), until: Date.now() + pace(3000, 1000) });
    renderTable();
    const chip = $('table').querySelector(`.w[data-w="${CSS.escape(e.word)}"]`);
    if (!chip) return;
    const block = chip.closest('.pl');
    const sc = block && block.querySelector('.sc');
    if (e.first) {                                // the first word of its length: the x2 animation brings the points
      const r = from && from.getBoundingClientRect();
      queueFx(() => firstAnim(e, r && r.width ? r : null));
    } else if (sc) {
      sc.classList.remove('pop'); void sc.offsetWidth; sc.classList.add('pop');
      sc.append(el('span', 'plus', '+' + score(e.points)));
    }
    if (e.kind === 'rep') {
      chip.classList.remove('hit'); void chip.offsetWidth; chip.classList.add('hit');
      const x = chip.querySelector('.x'); if (x && shownN(e.n) !== shownN(e.n - 1)) x.classList.add('pop');
      return;
    }
    const a = from && from.getBoundingClientRect(), b = chip.getBoundingClientRect();
    if (!a || !a.width || !b.width) { chip.classList.add('hit'); return; }   // landed with no flight (busy chat)
    chip.classList.add('hidden');
    const fly = pace(650, 100);
    const f = from.cloneNode(true); f.className = 'flyer';
    Object.assign(f.style, { left: a.left + 'px', top: a.top + 'px', transitionDuration: fly + 'ms' });
    document.body.append(f);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      f.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${(b.width / a.width).toFixed(3)})`;
    }));
    setTimeout(() => { f.remove(); chip.classList.remove('hidden'); chip.classList.add('hit'); }, fly + 30);
  }
  setInterval(() => {                             // the namer's pill is gone when its time is up
    const now = Date.now();
    namers.forEach((m, w) => {
      if (now < m.until) return;
      namers.delete(w);
      $('table').querySelectorAll(`.w[data-w="${CSS.escape(w)}"] .namer`).forEach(n => n.remove());
    });
  }, 250);

  function chip(w) {
    const h = held.get(w.w);
    const c = tiles(w.w);
    c.dataset.w = w.w;
    const n = shownN(h && h.kind === 'rep' ? h.n : w.n);
    if (n > 1) c.append(el('span', 'x', '×' + n));
    if ((h && h.kind === 'ok') || inAir.has(w.w)) c.classList.add('hidden');
    const m = namers.get(w.w), now = Date.now();
    if (m && now < m.until) {                     // the table is redrawn often: the pill keeps its own clock
      const pill = el('span', 'namer' + (now - m.at < 150 ? ' in' : ''));
      pill.append(avatar(m.name, m.avatar), el('span', '', m.name));
      pill.style.setProperty('--out', Math.max(0, m.until - now - 400) + 'ms');
      c.append(pill);
    }
    return c;
  }
  // a player: the avatar with the points, then the words - a line takes as many as fit its width
  const SQUEEZE = [0.94, 0.88, 0.82];
  function fill(block, p) {
    block.replaceChildren();
    // no nick: the avatar with the points on its top right corner
    const pa = el('span', 'pa');
    pa.append(avatar(p.name, p.avatar), lcd(p.score + (adj.get(p.id) || 0)));
    // as few lines as possible: each word goes to the first line with room for it (squeezed a little if need be),
    // a new line only when none has
    const lines = [];
    const addLine = (...head) => {
      const L = { line: el('div', 'line'), ws: el('div', 'ws'), n: 0, wf: 1 };
      L.line.append(...head, L.ws);
      block.append(L.line);
      lines.push(L);
      return L;
    };
    const fits = L => L.line.scrollWidth <= L.line.clientWidth + 1;
    const place = (L, c) => {
      L.ws.append(c);
      if (fits(L)) { L.n++; return true; }
      const k = SQUEEZE.find(x => x < L.wf && (L.ws.style.setProperty('--wf', x), fits(L)));
      if (k) { L.wf = k; L.n++; return true; }
      L.ws.style.setProperty('--wf', L.wf);
      c.remove();
      return false;
    };
    addLine(pa);
    p.words.forEach(w => {
      const c = chip(w);
      if (!lines.some(L => place(L, c))) { const L = addLine(); L.ws.append(c); L.n = 1; }
    });
  }
  const blocks = new Map();                       // player id -> its element (kept: rows move, not blink)
  // a player's row slides only when they change places with another player; a row that just grows or shrinks
  // (words land, lines repack) and the rows under it simply take their new place - no animation that starts
  // again and again while the chat is busy
  function renderTable() {
    clearTimeout(tableTimer); tableTimer = 0; tableAt = Date.now();
    if (!S) return;
    const box = $('table');
    const shown = [...box.children].filter(b => b.dataset.id);
    const rankWas = new Map(shown.map((b, i) => [b.dataset.id, i]));   // in the old order
    const before = new Map(shown.map(b => [b.dataset.id, b.getBoundingClientRect().top]));   // where it is seen now
    const list = S.players || [];
    if (!list.length) {
      blocks.clear();
      box.replaceChildren(el('div', 'empty', t('a.empty')));
      return;
    }
    box.querySelectorAll('.empty').forEach(n => n.remove());
    const keep = new Set();
    list.forEach((p, i) => {
      let b = blocks.get(p.id);
      if (!b) {
        b = el('div', 'pl enter'); b.dataset.id = p.id; blocks.set(p.id, b);
        setTimeout(() => b.classList.remove('enter'), 500);
      }
      keep.add(p.id);
      b.classList.toggle('lead', i === 0 && p.score > 0);
      box.append(b);                              // in the order of the points
      fill(b, p);
    });
    blocks.forEach((b, id) => { if (!keep.has(id)) { b.remove(); blocks.delete(id); } });
    // only whole players: one who doesn't fit above the chat zone is not shown at all (measured on the layout,
    // a row in the middle of its slide counts where it stands)
    const limit = box.offsetTop + box.clientHeight;
    [...box.children].forEach(b => { if (b.offsetTop + b.offsetHeight > limit + 1) b.remove(); });
    // the rows shown before and now, in the old and in the new order: a row slides only if its place among them changed
    const order = [...box.children].map(b => b.dataset.id);
    const now = order.filter(id => rankWas.has(id)), then = [...rankWas.keys()].filter(id => order.includes(id));
    now.forEach((id, i) => {
      const b = blocks.get(id);
      if (then[i] === id || !b) return;
      b.getAnimations().forEach(a => { if (!(a instanceof CSSAnimation)) a.cancel(); });
      const d = before.get(id) - b.getBoundingClientRect().top;
      if (Math.abs(d) > 1) b.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: pace(550, 100), easing: 'cubic-bezier(.3,.9,.3,1)' });
    });
  }
  // a busy chat sends a state on every word: the table is redrawn at most every 250 ms (calm) .. 100 ms (busy)
  let tableTimer = 0, tableAt = 0;
  function renderTableSoon() {
    if (!tableTimer) tableTimer = setTimeout(renderTable, Math.max(0, tableAt + pace(250, 100) - Date.now()));
  }


  // ------------------------------------------------------------ bonuses
  // the first word of a length: the word pops up in gold tiles, the player's avatar and nick by a 3D "×2" that
  // spins, grows and turns into the points, which fly to the player's score; the end of the round (BONUS phase):
  // the most repeated words rise to the centre with their owners' avatars, burst, their green ×N becomes a 3D "+N"
  // (three words of one player: the sum, then ×2). The table shows a score without the points still in the air.
  const adj = new Map();                          // player id -> points to add to the score shown (- in the air, + landed early)
  const inAir = new Set();                        // WORD: its copy is in the air, hidden in the table
  let fxGen = 0, fxChain = Promise.resolve();
  function addAdj(id, d) { const v = (adj.get(id) || 0) + d; if (Math.abs(v) < 1e-9) adj.delete(id); else adj.set(id, v); }
  function queueFx(fn) { const gen = fxGen; fxChain = fxChain.then(() => gen === fxGen && fn()).catch(err => console.warn('[anagram] fx', err)); }
  function resetFx() {
    if (!adj.size && !inAir.size && !$('fx').children.length) return;
    fxGen++; fxChain = Promise.resolve();
    $('fx').replaceChildren(); $('dim').getAnimations().forEach(a => a.cancel());
    adj.clear(); inAir.clear();
    renderTable();
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const anim = (n, k, o) => n.animate(k, Object.assign({ fill: 'forwards' }, o)).finished;
  const U = () => $('uProbe').offsetWidth / 100;  // var(--u) in px
  // a point / box in the stage's own coordinates (the stage may be scaled in the chroma key mode)
  function rel(r) {
    const st = $('stage'), s = st.getBoundingClientRect(), k = s.width / st.offsetWidth || 1;
    if (r instanceof Element) r = r.getBoundingClientRect();
    return { x: (r.left - s.left + r.width / 2) / k, y: (r.top - s.top + r.height / 2) / k, w: r.width / k, h: r.height / k };
  }
  function place(node, x, y) { node.style.left = x + 'px'; node.style.top = y + 'px'; }
  const rowOf = id => { const b = blocks.get(id); return b && b.isConnected ? b : null; };
  const scoreOf = id => { const b = rowOf(id); return b && b.querySelector('.sc'); };
  const chipOf = (id, w) => { const b = rowOf(id); return b && b.querySelector(`.w[data-w="${CSS.escape(w)}"]`); };
  async function flyTo(node, target, ms = 520) {
    const a = rel(node);
    if (!target) return anim(node, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
    const b = rel(target);
    return anim(node, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(.1)`, opacity: .5 }],
      { duration: ms, easing: 'cubic-bezier(.55,0,.85,.4)' });
  }
  function landScore(id, pts) {                   // the points reach the score: it shows them and pops
    addAdj(id, pts);
    renderTable();
    const sc = scoreOf(id);
    if (!sc) return;
    sc.classList.remove('pop'); void sc.offsetWidth; sc.classList.add('pop');
    sc.append(el('span', 'plus', '+' + score(pts)));
    fx('coin');
  }
  function sparks(x, y, colors, n, dist) {
    const u = U();
    for (let i = 0; i < n; i++) {
      const s = el('div', 'spark'), c = colors[i % colors.length];
      s.style.background = c; s.style.boxShadow = `0 0 ${u * 1.5}px ${c}`; place(s, x, y); $('fx').append(s);
      const a = Math.random() * Math.PI * 2, d = (dist * .5 + Math.random() * dist) * u;
      anim(s, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.2)`, opacity: 0 }],
        { duration: 600 + Math.random() * 400, easing: 'cubic-bezier(.1,.8,.3,1)' }).then(() => s.remove());
    }
  }
  // a 3D figure: the text in stacked layers (translateZ), a real extruded object that can spin
  function obj3d(text, kind, fs) {
    const u = U(), L = 16, o = el('div', 'o3d ' + kind), hue = kind === 'gold' ? 36 : 110;
    o.style.setProperty('--fs', fs);
    for (let i = L - 1; i >= 0; i--) {
      const s = el('span', 'ly ' + (i ? 'side' : 'front'), text);
      s.style.transform = `translateZ(${-i * fs * .012 * u}px)`;
      if (i) s.style.color = `hsl(${hue} 100% ${42 - i * 1.6}%)`;
      o.append(s);
    }
    o.set = t => o.querySelectorAll('.ly').forEach(s => { s.textContent = t; });
    return o;
  }
  const TILT = 'rotateX(12deg)';
  const wobble = o => o.animate([{ transform: `${TILT} rotateY(-18deg)` }, { transform: `${TILT} rotateY(18deg)` }],
    { duration: 700, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
  async function flip(o, text) {                  // edge-on, the new text, back
    o.getAnimations().forEach(a => a.cancel());
    await anim(o, [{ transform: `${TILT} rotateY(0)` }, { transform: `${TILT} rotateY(90deg)` }], { duration: 140, easing: 'ease-in' });
    o.set(text);
    await anim(o, [{ transform: `${TILT} rotateY(-90deg)` }, { transform: `${TILT} rotateY(0)` }], { duration: 240, easing: 'ease-out' });
  }
  function holder(x, y, glow) {
    const h = el('div', 'fxabs ' + glow), pp = el('div', 'persp');
    h.append(pp); place(h, x, y); $('fx').append(h); h.pp = pp;
    return h;
  }

  async function firstAnim(e, from) {
    const gen = fxGen, alive = () => gen === fxGen, u = U(), board = rel($('board'));
    const cx = board.x, wy = board.y - board.h * .2, cy = board.y + board.h * .12;
    // the word itself, from the answer line, in big gold tiles
    const big = el('div', 'fxabs fxtiles');
    big.style.setProperty('--tw', `calc(var(--u) * ${Math.min(9, 80 / (e.word.length * 1.12)).toFixed(2)})`);
    [...e.word].forEach(c => big.append(el('span', 't', c)));
    place(big, cx, wy); $('fx').append(big);
    fx('rise');
    const b = rel(big), a = from ? rel(from) : null;
    anim(big, [{ transform: a ? `translate(calc(-50% + ${a.x - b.x}px), calc(-50% + ${a.y - b.y}px)) scale(${a.w / b.w})` : 'translate(-50%,-50%) scale(.2)', opacity: a ? 1 : 0 },
      { transform: 'translate(-50%,-50%) scale(1.12)', opacity: 1, offset: .75 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }],
      { duration: 650, easing: 'cubic-bezier(.3,1.2,.5,1)' });
    // the player, highlighted, left of the ×2
    const h = holder(cx + 10 * u, cy, 'glow-gold'), o = obj3d('×2', 'gold', 30);
    h.pp.append(o);
    const who = el('div', 'fxwho');
    who.append(avatar(e.name, e.avatar), el('span', 'nm', clean(e.name)));
    h.append(who);
    who.animate([{ opacity: 0, transform: 'translateY(-50%) scale(0)' }, { opacity: 1, transform: 'translateY(-50%) scale(1.15)', offset: .7 },
      { opacity: 1, transform: 'translateY(-50%) scale(1)' }], { duration: 420, delay: 250, fill: 'backwards', easing: 'ease-out' });
    await wait(300); if (!alive()) return;
    sparks(cx + 10 * u, cy, ['#ffd84a', '#fff', '#ff9800'], 14, 22);
    fx('spin', 1.3);
    await anim(o, [{ transform: `${TILT} rotateY(-90deg) scale(.12)`, opacity: 0 }, { opacity: 1, offset: .12 },
      { transform: `${TILT} rotateY(720deg) scale(1)`, opacity: 1 }], { duration: 1300, easing: 'cubic-bezier(.2,.7,.25,1)' });
    if (!alive()) return;
    fx('ding');
    await flip(o, String(e.points));
    sparks(cx + 10 * u, cy, ['#ffd84a', '#fff'], 16, 26);
    wobble(o);
    await wait(1100); if (!alive()) return;
    fx('whoosh');
    await Promise.all([flyTo(h, scoreOf(e.uid)), flyTo(big, chipOf(e.uid, e.word))]);
    if (!alive()) return;
    h.remove(); big.remove();
    landScore(e.uid, e.points);
    const c = chipOf(e.uid, e.word);
    if (c) { c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit'); }
  }

  async function endBonus(ev) {
    const gen = fxGen, alive = () => gen === fxGen, items = ev.items || [];
    if (!items.length) return;
    const fxL = $('fx'), u = U(), board = rel($('board')), k = items.length;
    const S = k === 1 ? 2.4 : 1.7, avS = (k === 1 ? 16 : 11) * u, gap = 3 * u, cy = board.y, W = $('stage').offsetWidth;
    await anim($('dim'), [{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
    if (!alive()) return;
    const objs = items.map((it, i) => {
      const orig = chipOf(it.uid, it.word), r = orig ? rel(orig) : { x: board.x, y: board.y, w: 0, h: 0 };
      const clone = tiles(it.word); clone.classList.add('fxabs');
      const n = shownN(it.n);
      if (n > 1) clone.append(el('span', 'x', '×' + n));
      place(clone, r.x, r.y); fxL.append(clone);
      const w = r.w || clone.offsetWidth;
      inAir.add(it.word);
      const oa = rowOf(it.uid) && rowOf(it.uid).querySelector('.pa > .av'), ra = oa ? rel(oa) : { x: board.x, y: board.y, w: 6 * u };
      const av = avatar(it.name, it.avatar); place(av, ra.x, ra.y); av.style.width = av.style.height = ra.w + 'px'; fxL.append(av);
      const ty = cy + (i - (k - 1) / 2) * board.h * .24, ww = w * S, left = W / 2 - (avS + gap + ww) / 2;
      return { it, clone, av, r: { ...r, w }, ra, ty, tx: left + avS + gap + ww / 2, ax: left + avS / 2 };
    });
    renderTable();                                // the words in the air are hidden in the table
    // the words rise to the centre, growing; the owners' avatars grow beside them
    fx('rise');
    const ease = 'cubic-bezier(.3,1.25,.5,1)';
    await Promise.all(objs.map((o, i) => wait(i * 200).then(() => Promise.all([
      anim(o.clone, [{ left: o.r.x + 'px', top: o.r.y + 'px', transform: 'translate(-50%,-50%) scale(1)' },
        { left: o.tx + 'px', top: o.ty + 'px', transform: `translate(-50%,-50%) scale(${S})` }], { duration: 900, easing: ease }),
      anim(o.av, [{ left: o.ra.x + 'px', top: o.ra.y + 'px', width: o.ra.w + 'px', height: o.ra.w + 'px', fontSize: o.ra.w * .45 + 'px' },
        { left: o.ax + 'px', top: o.ty + 'px', width: avS + 'px', height: avS + 'px', fontSize: avS * .45 + 'px' }], { duration: 900, easing: ease }),
    ]))));
    if (!alive()) return;
    objs.forEach(o => o.clone.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.6)' }], { duration: 300, direction: 'alternate', iterations: 3 }));
    await wait(900); if (!alive()) return;
    // the word bursts, its green ×N becomes a 3D "+N"
    await Promise.all(objs.map((o, i) => wait(i * 180).then(async () => {
      const xEl = o.clone.querySelector('.x'), xr = xEl ? rel(xEl) : { x: o.tx, y: o.ty };
      o.clone.querySelectorAll('.t').forEach(t => {
        const a = Math.random() * Math.PI * 2, d = (14 + Math.random() * 16) * u / S;
        t.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) rotate(${(Math.random() - .5) * 600}deg) scale(.3)`, opacity: 0 }],
          { duration: 550, easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'forwards' });
      });
      sparks(o.tx, o.ty, ['#39ff14', '#fff', '#b8ff9a'], 22, k === 1 ? 32 : 22);
      fx('burst'); setTimeout(() => fx('plusN'), 250);
      if (xEl) xEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
      const h = holder(xr.x, xr.y, 'glow-lime'), ob = obj3d('+' + o.it.n, 'lime', k === 1 ? 24 : 15);
      h.pp.append(ob); o.num = h;
      anim(h, [{ left: xr.x + 'px', top: xr.y + 'px' }, { left: o.tx + 'px', top: o.ty + 'px' }], { duration: 650, easing: 'cubic-bezier(.3,1,.5,1)' });
      await anim(ob, [{ transform: `${TILT} rotateY(-140deg) scale(.2)` }, { transform: `${TILT} rotateY(360deg) scale(1)` }],
        { duration: 950, easing: 'cubic-bezier(.2,.8,.3,1)' });
      wobble(ob);
      o.clone.remove();
    })));
    await wait(700); if (!alive()) return;
    if (!ev.combo) {
      await Promise.all(objs.map((o, i) => wait(i * 220).then(async () => {
        const target = scoreOf(o.it.uid);
        fx('whoosh');
        await Promise.all([flyTo(o.num, target), flyTo(o.av, target)]);
        if (!alive()) return;
        o.num.remove(); o.av.remove();
        landScore(o.it.uid, o.it.n);
      })));
    } else {
      // all three are one player's: the numbers merge into the sum, then ×2
      const id = items[0].uid, sum = items.reduce((s, it) => s + it.n, 0), nx = W / 2 + 9 * u, ax = W / 2 - 24 * u;
      fx('whoosh');
      await Promise.all(objs.map(o => {
        const a = rel(o.num);
        return Promise.all([
          anim(o.num, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
            { transform: `translate(calc(-50% + ${nx - a.x}px), calc(-50% + ${cy - a.y}px)) scale(.7)`, opacity: 0 }], { duration: 480, easing: 'ease-in' }),
          anim(o.av, [{ left: o.ax + 'px', top: o.ty + 'px', width: avS + 'px', height: avS + 'px', fontSize: avS * .45 + 'px' },
            { left: ax + 'px', top: cy + 'px', width: 18 * u + 'px', height: 18 * u + 'px', fontSize: 8 * u + 'px' }], { duration: 480, easing: 'ease-in-out' }),
        ]);
      }));
      if (!alive()) return;
      objs.slice(1).forEach(o => o.av.remove());
      objs.forEach(o => o.num.remove());
      const av = objs[0].av; av.style.boxShadow = `0 0 ${3 * u}px rgba(255,216,74,.8)`;
      const h = holder(nx, cy, 'glow-lime'), ob = obj3d('+' + sum, 'lime', 26);
      h.pp.append(ob);
      sparks(nx, cy, ['#39ff14', '#fff'], 20, 28);
      fx('plusN');
      await anim(ob, [{ transform: `${TILT} rotateY(0) scale(.6)` }, { transform: `${TILT} rotateY(360deg) scale(1)` }], { duration: 700, easing: 'cubic-bezier(.2,.8,.3,1)' });
      wobble(ob);
      await wait(400); if (!alive()) return;
      const hx = holder(nx + 4 * u, cy - 26 * u, 'glow-gold'), ox = obj3d('×2', 'gold', 20);
      hx.pp.append(ox);
      fx('spin', 1.1);
      await anim(ox, [{ transform: `${TILT} rotateY(-90deg) scale(.1)`, opacity: 0 }, { opacity: 1, offset: .15 },
        { transform: `${TILT} rotateY(720deg) scale(1.2)`, opacity: 1 }], { duration: 1100, easing: 'cubic-bezier(.2,.7,.25,1)' });
      wobble(ox);
      await wait(350); if (!alive()) return;
      await anim(hx, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: `translate(calc(-50% - ${4 * u}px), calc(-50% + ${26 * u}px)) scale(.3)`, opacity: 0 }],
        { duration: 300, easing: 'cubic-bezier(.6,0,.9,.5)' });
      hx.remove();
      sparks(nx, cy, ['#ffd84a', '#39ff14', '#fff'], 28, 36);
      fx('x2');
      await flip(ob, '+' + sum * 2);
      ob.animate([{ transform: `${TILT} scale(1)` }, { transform: `${TILT} scale(1.25)` }, { transform: `${TILT} scale(1)` }], { duration: 400 });
      await wait(450); wobble(ob);
      await wait(900); if (!alive()) return;
      fx('whoosh');
      const target = scoreOf(id);
      await Promise.all([flyTo(h, target), flyTo(av, target)]);
      if (!alive()) return;
      h.remove(); av.remove();
      landScore(id, sum * 2);
    }
    inAir.clear(); renderTable();
    await anim($('dim'), [{ opacity: 1 }, { opacity: 0 }], { duration: 400 });
  }

  // ------------------------------------------------------------ events from the server
  function onEvent(e) {
    const name = clean(e.name), NAME = name.toUpperCase();
    const sname = AudioKit.spokenName(e.name);
    switch (e.type) {
      case 'try': hold(e); pushTry(e); break;
      case 'countdown':
        held.clear(); namers.clear(); tries.length = 0; resetFx();
        break;
      case 'bonus':                               // the end of the round: the x2 animations still running give way
        resetFx();
        endBonus(e).catch(err => console.warn('[anagram] bonus', err));
        break;
      case 'round_start':
        voice('round', t('g.v.round', { n: e.round }), 'urgent', 1);
        break;
      case 'streak':
        fx('streak', e.n);
        toast(NAME, t('g.t.streak', streakP(e.n)), 'var(--orange)', { huge: e.n >= 3, important: true, hold: e.n >= 5 ? 2.8 : 2, id: 'streak' });
        voice('streak', t('g.v.streak', Object.assign(streakP(e.n), { name: sname })), 'high');
        break;
      case 'gift':
        fx('gift');
        mini(t('g.t.gift', { name, gift: clean(e.gift) }) + (e.count > 1 ? ' ×' + e.count : ''), 'gift', 'gift');
        break;
      case 'follow':
        fx('follow');
        mini(t('g.t.followed', { name }), 'follow', 'thanks');
        break;
      case 'fans_only':
        queueTicker(t('g.tk.fans', { name: esc(name), n: e.n }));
        break;
      case 'follow_needed':
        mini(t('g.t.followToPlay', { name }), 'follow', 'follow_needed');
        break;
      case 'timeout':
        fx('timeout');
        toast(t('g.t.timeUp'), '', 'var(--orange)', { huge: true, important: true, keep: true, hold: 1.4, id: 'time_up' });
        voice('winner', t('a.v.nobody'), 'high', 1);
        break;
      case 'winner':
        fx('winner');
        voice('winner', t('a.v.winner', { name: sname, points: I18N.n(e.score, 'point') }), 'urgent', 1);
        break;
    }
  }

  // ------------------------------------------------------------ the tops by the camera (Guess the Word's)
  let tgBot = '', champGroups = [], likersData = null, sidesKey = {};
  const SCREEN_DEFAULT = {
    screen: 1, tops: 1, top_stream: 'always', top_planes: 'always', top_balloons: 'always',
    top_stream_every: 5, top_stream_dur: 30, top_planes_every: 5, top_planes_dur: 30, top_balloons_every: 5, top_balloons_dur: 30,
    carousel_slot: 15, carousel_pause: 0, carousel_side: 'l', bot: 'always', bot_every: 3, bot_dur: 30,
    gifts: 'periodic', gifts_every: 3, gifts_dur: 10, gifts_view: 'line', gifts_place: 'host',
  };
  let scr = SCREEN_DEFAULT;
  const TOPS = ['stream', 'planes', 'balloons'], TOP_SIDE = { stream: 'r', planes: 'l', balloons: 'l' };
  const nowSec = () => Date.now() / 1000;
  const onAir = (mode, every, dur) => mode === 'always' || (mode === 'periodic' && nowSec() % (every * 60) < dur);
  function shownTops() {
    const out = {};
    if (!scr.screen || !scr.tops) return out;
    const has = { stream: champGroups.length > 0, planes: !!(likersData && (likersData.planes || []).length),
                  balloons: !!(likersData && likersData.balloon) };
    const ring = TOPS.filter(k => scr['top_' + k] === 'carousel' && has[k]);
    let turn = null;
    if (ring.length) {
      const run = ring.length * scr.carousel_slot, ph = nowSec() % (run + scr.carousel_pause * 60);
      if (ph < run) turn = ring[Math.floor(ph / scr.carousel_slot)];
    }
    TOPS.forEach(k => {
      const m = scr['top_' + k];
      if (m === 'carousel' ? k === turn : onAir(m, scr['top_' + k + '_every'], scr['top_' + k + '_dur'])) {
        out[k] = m === 'carousel' ? scr.carousel_side : TOP_SIDE[k];
      }
    });
    return out;
  }
  // what the stream's gifts do: "one by one" - each gift in turn; tiles / ticker / column - all at once
  const PROMO_FIRST = 30000, PROMO_GAP = 600;
  let promos = [], promoGen = 0, promoCfg = '';
  const promoEl = el('div', 'giftpromo'), giftsBox = el('div', 'giftsbox');
  function promoSeries(gen) {
    if (gen !== promoGen) return;
    const show = scr.gifts_dur * 1000, start = Date.now();
    const n = scr.screen && scr.gifts !== 'never' && scr.gifts_view === 'line' ? promos.length : 0;
    for (let i = 0; i < n; i++) {
      setTimeout(() => { if (gen === promoGen && promos[i]) showPromo(promos[i], show); }, i * (show + PROMO_GAP));
    }
    const end = start + n * (show + PROMO_GAP);
    const next = scr.gifts === 'always' ? end : Math.max(start + scr.gifts_every * 60000, end + 10000);
    setTimeout(() => promoSeries(gen), Math.max(1000, next - Date.now()));
  }
  function restartPromo(delay) {
    const gen = ++promoGen;
    promoEl.classList.remove('on');
    setTimeout(() => promoSeries(gen), delay);
  }
  function giftLabel(p) {
    const name = I18N.lang === 'ru' && p.ru ? p.ru : p.gift;
    return p.rule.startsWith('gift:') ? name : p.rule === 'any' ? t('g.promo.any') : t('g.promo.min', { n: p.coins });
  }
  function giftPic(p) {
    if (!p.images.length) return el('span', 'gi', '🎁');
    const i = el('img'); i.src = p.images[0]; i.referrerPolicy = 'no-referrer';
    return i;
  }
  let giftsBoxKey = '';
  function renderGiftsBox() {
    const key = JSON.stringify([promos, scr.gifts_view, I18N.lang]);
    if (key === giftsBoxKey) return;
    giftsBoxKey = key;
    giftsBox.className = 'giftsbox ' + scr.gifts_view;
    const items = [...promos].sort((a, b) => (a.coins || 0) - (b.coins || 0)).map(p => {
      const it = el('span', 'gitem');
      it.append(giftPic(p), el('span', 'tx', t('g.promo.' + p.action)));
      it.title = giftLabel(p);
      return it;
    });
    if (scr.gifts_view === 'ticker') {
      const run = el('span', 'run');
      run.append(...items);
      run.style.animationDuration = Math.max(8, promos.length * 4) + 's';
      giftsBox.replaceChildren(run);
    } else giftsBox.replaceChildren(...items);
  }
  function showPromo(p, ms) {
    promoEl.replaceChildren();
    if (p.images.length > 1) {
      const st = el('span', 'stack');
      p.images.forEach(src => { const i = el('img'); i.src = src; i.referrerPolicy = 'no-referrer'; st.append(i); });
      promoEl.append(st);
    } else promoEl.append(giftPic(p));
    const txt = el('span', 'tx', t('g.promo.' + p.action));
    txt.append(el('small', '', giftLabel(p)));
    promoEl.append(txt);
    promoEl.classList.add('on');
    setTimeout(() => promoEl.classList.remove('on'), ms);
  }
  restartPromo(PROMO_FIRST);
  function setScreen(s) {
    scr = { ...SCREEN_DEFAULT, ...(s.screen || {}) };
    const cfg = JSON.stringify([scr.screen, scr.gifts, scr.gifts_every, scr.gifts_dur, scr.gifts_view]);
    if (promoCfg && cfg !== promoCfg) restartPromo(1000);
    promoCfg = cfg;
  }
  function who(row, g) {
    if (g.n === 1) row.append(avatar(g.players[0].name, g.players[0].avatar), el('span', 'cn', g.players[0].name));
    else {
      const stack = el('span', 'stack');
      g.players.slice(0, 3).forEach(p => stack.append(avatar(p.name, p.avatar)));
      if (g.n > 3) stack.append(el('span', 'more', '+' + (g.n - 3)));
      row.append(stack);
    }
  }
  function topRows(k) {
    if (k === 'stream') {                         // stream champions: rounds won
      return champGroups.map((g, i) => {
        const row = el('div', 'champ');
        who(row, g);
        row.append(el('span', 'cw', String(g.wins)), el('span', 'cm', ['🥇', '🥈', '🥉'][i]));
        return row;
      });
    }
    const l = likersData || {};                   // top pilots (planes launched) / balloons
    const groups = k === 'planes' ? (l.planes || []).map(g => ['✈️', g]) : l.balloon ? [['🎈', l.balloon]] : [];
    return groups.map(([icon, g]) => {
      const row = el('div', 'champ liker');
      row.append(el('span', 'cm', icon), el('span', 'cw', String(g.count)));
      who(row, g);
      return row;
    });
  }
  function renderSides() {
    const tops = shownTops();
    const bot = !!(scr.screen && tgBot && onAir(scr.bot, scr.bot_every, scr.bot_dur));
    const gifts = scr.screen && scr.gifts !== 'never';
    const boxOn = gifts && scr.gifts_view !== 'line' && promos.length > 0 && onAir(scr.gifts, scr.gifts_every, scr.gifts_dur);
    const place = scr.gifts_place === 'bottom' && TT && S && S.chatZone ? 'bottom' : 'host';
    if (boxOn) renderGiftsBox();
    const gift = !gifts ? null : scr.gifts_view === 'line' ? promoEl : boxOn ? giftsBox : null;
    const giftKey = gift ? [scr.gifts_view, giftsBoxKey] : null;
    const topData = { stream: champGroups, planes: likersData && likersData.planes, balloons: likersData && likersData.balloon };
    const side = (s) => TOPS.filter(k => tops[k] === s).map(k => [k, topData[k]]);
    const keys = {
      champs: JSON.stringify([place === 'host' && giftKey, bot && tgBot, side('r')]),
      likers: JSON.stringify([side('l')]),
      giftsBottom: JSON.stringify(place === 'bottom' && giftKey),
    };
    Object.entries(keys).forEach(([id, key]) => {
      if (sidesKey[id] === key) return;
      sidesKey[id] = key;
      const box = $(id);
      box.replaceChildren();
      if (gift && (id === 'giftsBottom') === (place === 'bottom') && id !== 'likers') box.append(gift);
      if (id === 'champs' && bot) box.append(el('div', 'tgbot', '📲 @' + tgBot));
      TOPS.forEach(k => { if (tops[k] && (tops[k] === 'r') === (id === 'champs') && id !== 'giftsBottom') box.append(...topRows(k)); });
    });
  }
  setInterval(renderSides, 500);

  // ------------------------------------------------------------ frame: chroma key / TT mode (as in guess.js)
  const QS = new URLSearchParams(location.search);
  const ALPHA = QS.get('alpha') === '1';
  const TT = QS.get('tt') === '1' || ALPHA;
  if (TT) document.documentElement.classList.add('tt');
  if (ALPHA) document.documentElement.classList.add('alpha');
  function applyChroma(top, frame) {
    const root = document.documentElement;
    root.classList.toggle('chroma', top > 0);
    if (top > 0) root.style.setProperty('--chroma-top', `calc(var(--u) * ${(100 * frame / 9 * top / 100).toFixed(2)})`);
    root.style.setProperty('--fh', (100 * frame / 9).toFixed(2));
    if (ALPHA) root.style.setProperty('--game-bg-top', $('word').offsetTop + 'px');   // dark from the round's word on
    root.style.setProperty('--fr', (frame / 9).toFixed(4));
    const zone = $('chromaZone'), stage = $('stage');
    if (top > 0) {
      if (zone.parentNode !== stage) stage.prepend(zone);
      let outer = $('outer');
      if (!outer && !TT) {
        outer = document.createElement('div'); outer.id = 'outer';
        stage.parentNode.insertBefore(outer, stage);
        outer.appendChild(stage);
      }
      const bar = document.querySelector('.ctl-bar');
      if (outer && bar && bar.parentNode !== outer) outer.appendChild(bar);
    } else if ($('outer')) {
      location.reload();
    }
  }

  // ------------------------------------------------------------ render state
  let wordKey = '';
  function renderWord(s) {
    const key = (s.word || '') + '|' + s.roundId;
    if (key === wordKey) return;
    wordKey = key;
    const box = $('word');
    if (!s.word) { box.replaceChildren(el('span', 'q', '? ? ?')); return; }
    const n = s.word.length;
    box.style.setProperty('--tw', `calc(var(--u) * ${Math.min(8, 95 / (n * 1.12)).toFixed(2)})`);
    box.replaceChildren(...[...s.word].map((c, i) => {
      const tl = el('span', 't in', c); tl.style.animationDelay = i * 70 + 'ms'; return tl;
    }));
  }
  function renderWinner(s) {
    const w = s.winner;
    $('wAvatar').replaceChildren();
    $('wChips').replaceChildren();
    $('wTitle').textContent = t(w ? 'a.w.title' : 'a.w.nobody');
    $('wTitle').className = 'wtitle' + (w ? '' : ' timeout');
    if (w) {
      $('wAvatar').append(avatar(w.name, w.avatar));
      fitText($('wName'), w.name);
      $('wSub').textContent = I18N.n(w.score, 'point');
      $('wChips').append(el('span', 'chip', '🔤 ' + t('a.w.words', { n: w.words })));
      if (w.streak >= 2) $('wChips').append(el('span', 'chip streak', t('g.w.streak', streakP(w.streak))));
    } else {
      $('wName').textContent = ''; $('wSub').textContent = t('a.r.was');
    }
    $('wWord').replaceChildren(...tiles(s.word || '').childNodes);
  }
  function streamLeaders(box, list) {
    box.replaceChildren();
    list.slice(0, 5).forEach((p, i) => {
      const l = el('div', 'line');
      l.append(el('span', '', ['🥇', '🥈', '🥉', '4.', '5.'][i] + ' ' + p.name),
               el('span', '', p.wins ? I18N.n(p.wins, 'win') : I18N.n(p.podiums, 'podium')));
      box.append(l);
    });
    if (!list.length) box.append(el('div', 'line', t('g.r.noWinners')));
  }
  const PROMO_ICONS = ['❤️', '💜', '👥', '🎯', '🔥'];
  const PROMO_COLORS = ['var(--magenta)', 'var(--cyan)', 'var(--lime)', 'var(--gold)', 'var(--orange)'];
  let promoKey = '';
  function renderPromo(lines) {
    const key = lines.join('|');
    if (key === promoKey) return;
    promoKey = key;
    $('promo').replaceChildren(...lines.map((line, i) => {
      const p = el('div', 'p', PROMO_ICONS[i % PROMO_ICONS.length] + ' ' + line.toUpperCase());
      p.style.setProperty('--c', PROMO_COLORS[i % PROMO_COLORS.length]);
      return p;
    }));
  }
  let promoI = -1;
  function highlightPromo(step) {
    const items = $('promo').children;
    if (!items.length || step === promoI) return;
    promoI = step;
    [...items].forEach((n, i) => n.classList.toggle('on', i === step % items.length));
  }
  function renderReveal(s) {
    $('rWord').replaceChildren(...tiles(s.word || '').childNodes);
    const pod = $('podium'); pod.replaceChildren();
    [1, 0, 2].forEach(i => {
      const p = s.podium[i];
      if (!p) return;
      const col = el('div', 'pcol p' + (i + 1));
      col.append(avatar(p.name, p.avatar), el('div', 'nm', p.name), el('div', 'rk', I18N.n(p.score, 'point')),
                 el('div', 'step', String(i + 1)));
      pod.append(col);
    });
    const top = $('rTop'); top.replaceChildren();
    (s.players || []).slice(0, 6).forEach(p => {
      const l = el('div', 'line');
      l.append(el('span', '', p.name), el('span', '', String(p.score)));
      top.append(l);
    });
    if (!(s.players || []).length) top.append(el('div', 'line', '—'));
    streamLeaders($('rStream'), s.streamLeaderboard);
    streamLeaders($('lStream'), s.streamLeaderboard);
    const long = $('rLong'); long.replaceChildren();
    if (s.longest) long.append(el('span', '', t('a.r.longest') + ' — ' + s.longest.name), tiles(s.longest.word));
    renderPromo(s.promo || []);
  }

  function render(s) {
    const roundChanged = !S || S.roundId !== s.roundId;
    S = s;
    applyChroma(TT ? (s.chroma || s.chromaTop || 33) : (s.chroma || 0), s.frame || 16);
    document.documentElement.style.setProperty('--chat-zone', TT && s.chatZone
      ? `calc(var(--u) * ${(100 * (s.frame || 16) / 9 * s.chatZone / 100).toFixed(2)})` : '0px');
    champGroups = s.champions || [];
    setScreen(s);
    renderSides();
    $('error').hidden = !s.error;
    if (s.error) { $('errText').textContent = t('g.err') + s.error; return; }
    $('roundChip').textContent = t('g.round', { n: s.roundId });
    $('playersChip').textContent = '👥 ' + s.stats.players;
    renderWord(s);
    if (s.phase !== 'playing' && s.phase !== 'bonus') resetFx();   // the state has the final scores
    if (roundChanged) { blocks.clear(); $('table').replaceChildren(); renderTable(); }
    else renderTableSoon();
    $('winner').hidden = s.phase !== 'winner';
    $('reveal').hidden = s.phase !== 'reveal';
    if (s.phase === 'winner') renderWinner(s);
    if (s.phase === 'reveal') renderReveal(s);
    if (s.phase === 'playing') tickerFor(s);
  }

  // ------------------------------------------------------------ ticker at the CTA line
  let tickerRound = null, tickerTimers = [];
  function tickerText(s) {
    const parts = [], lr = s.lastRound;
    if (lr && lr.word) {
      parts.push(t('g.tk.word', { w: '<b>' + esc(lr.word.toUpperCase()) + '</b>' }));
      if (lr.winner) parts.push('🏆 ' + t('a.tk.winner', { name: esc(lr.winner), points: I18N.n(lr.score || 0, 'point') }));
    }
    const top = (s.streamLeaderboard || []).filter(r => r.wins > 0).slice(0, 5);
    if (top.length) parts.push('🏆 ' + t('g.tk.top') + ' ' + top.map(r => esc(r.name) + ' — ' + I18N.n(r.wins, 'win')).join(' · '));
    return parts.join('   ·   ');
  }
  const tickerQueue = [];
  function queueTicker(html) {
    if ($('bottom').classList.contains('ticking')) tickerQueue.push(html);
    else runTicker(html);
  }
  function runTicker(custom) {
    const html = custom || (S && S.phase === 'playing' && tickerText(S)), box = $('ticker');
    if (!html) return;
    if (!custom && $('bottom').classList.contains('ticking')) { tickerQueue.push(html); return; }
    box.replaceChildren();
    const sp = document.createElement('span');
    sp.innerHTML = html;
    box.appendChild(sp);
    const W = box.clientWidth, w = sp.scrollWidth;
    sp.style.setProperty('--from', W + 'px');
    sp.style.setProperty('--to', -w + 'px');
    sp.style.setProperty('--dur', ((W + w) / Math.max(120, W / 7)).toFixed(1) + 's');
    $('bottom').classList.add('ticking');
    sp.addEventListener('animationend', () => {
      sp.remove(); $('bottom').classList.remove('ticking');
      if (tickerQueue.length) runTicker(tickerQueue.shift());
    });
  }
  function tickerFor(s) {
    if (s.roundId === tickerRound) return;
    tickerRound = s.roundId;
    tickerTimers.forEach(clearTimeout);
    const since = Live.now() - s.startedAt;
    tickerTimers = [5, 60, 120].filter(at => at - since > -10)
      .map(at => setTimeout(runTicker, Math.max(0, at - since) * 1000));
  }

  // ------------------------------------------------------------ clock: timer, countdown, last 10 s, the break
  let lastBig = null;
  function bigNum(text, cls) {
    if (text === lastBig) return;
    lastBig = text;
    const b = $('bigNum');
    b.className = cls || '';
    b.replaceChildren();
    if (text !== '') b.append(el('span', '', text));
  }
  const fmtClock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  let breakVoice = {};
  function clock() {
    if (!S || S.error) return;
    const now = Live.now(), timerEl = $('timer');
    if (S.phase === 'playing') {
      const left = Math.max(0, Math.ceil(S.endsAt - now));
      timerEl.textContent = fmtClock(left);
      timerEl.classList.toggle('low', left <= 10);
      if (left <= 10 && left > 0) {
        if (lastBig !== String(left)) fx('tick', left);
        bigNum(String(left), 'final');
      } else bigNum('');
    } else if (S.phase === 'countdown') {
      const left = Math.ceil(S.phaseUntil - now);
      timerEl.textContent = '0:00'; timerEl.classList.remove('low');
      const lbl = left > 1 ? String(left - 1) : 'GO!';
      if (lastBig !== lbl) fx('count', lbl === 'GO!');
      bigNum(lbl, lbl === 'GO!' ? 'go' : 'cd');
    } else {
      timerEl.classList.remove('low');
      if (S.phase === 'reveal') {
        const left = Math.max(0, Math.ceil(S.phaseUntil - now));
        const elapsed = (S.breakSec || 0) - left;
        const lobby = elapsed >= (S.resultsSec || 25) && left > 0;
        $('rResults').hidden = lobby;
        $('lobby').hidden = !lobby;
        $('rNext').hidden = lobby;
        $('rNext').textContent = t('g.r.next', { t: fmtClock(left) });
        $('lTime').textContent = fmtClock(left);
        $('lTime').classList.toggle('soon', left <= 10);
        if (lobby) highlightPromo(Math.floor(elapsed / 4));
        const v = breakVoice[S.roundId] = breakVoice[S.roundId] || {};
        if (lobby && !v.start && left > 35) {
          v.start = true;
          const mins = Math.round(left / 60);
          voice('break', t('g.v.break', { t: mins >= 1 ? I18N.n(mins, 'minute') : t('g.seconds', { n: left }) }), 'high', 1);
        }
        if (!v.soon && left <= 30 && left > 25) { v.soon = true; voice('break', t('g.v.soon'), 'high'); }
      }
      if (lastBig !== 'GO!' || S.phase !== 'playing') bigNum('');
    }
  }
  setInterval(clock, 150);

  // ------------------------------------------------------------ rules + start
  function showRules(ms) {
    $('rules').hidden = false;
    clearTimeout(showRules.t);
    showRules.t = setTimeout(() => { $('rules').hidden = true; }, ms || 8000);
  }
  $('rules').onclick = () => { $('rules').hidden = true; };
  A.mount({ rules: () => ($('rules').hidden ? showRules(12000) : ($('rules').hidden = true)), hello: 'a.v.hello', helloRate: 1 });
  showRules(7000);
  Balloons.mount({ ground: true, area: $('stage'), bottom: 'calc(var(--u) * 26)', width: 'calc(var(--u) * 20)', sound: true });
  const cakeAt = () => {
    const cam = document.documentElement.classList.contains('chroma') && $('chromaZone').offsetHeight / $('stage').offsetHeight;
    return { sound: true, root: $('stage'), skyBottom: cam ? cam * .85 : undefined };
  };
  // gifts here only launch the animations every page has (hints, boosts... are Guess the Word's)
  const ANIMATIONS = ['balloon', 'plane', 'bomber', 'snowball', 'cake'];
  Live.start({ game: 'anagram', onState: (s, msg) => { tgBot = msg.tgBot || ''; promos = (msg.giftPromos || []).filter(p => ANIMATIONS.includes(p.action)); render(s); Balloons.render(msg.balloons);
                                                      likersData = (msg.balloons || {}).likers || null; renderSides(); }, onEvent,
               onFeed: e => {
                 if (e.type === 'balloon') Balloons.launch(e);
                 else if (e.type === 'plane') Plane.fly(e, { sound: true });
                 else if (e.type === 'snowball') Snowball.throw(e, { sound: true });
                 else if (e.type === 'cake') Cake.show(e, cakeAt());
                 else if (e.type === 'cake_fire') Cake.serverFire(e);
                 else if (e.type === 'cake_final') Cake.final(e);
                 else { if (e.type === 'chat') Cake.comment(e); Greeter.push(e); }
               } });
})();
