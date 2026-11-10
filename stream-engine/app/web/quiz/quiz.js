// Quiz overlay. All user text goes through textContent (no HTML injection).
// The stream "chrome" (frame and chroma / TT modes, side tops, what the gifts do, toasts, ticker) follows
// guess/guess.js and anagram/anagram.js: same settings, same look; the game part is the question, the chat line
// and the table of variants.
(() => {
  const $ = id => document.getElementById(id);
  const A = AudioKit, t = I18N.t;
  const clean = n => (n || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim() || 'Someone';
  const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const streakP = n => ({ n, wins: I18N.n(n, 'win'), winsUp: I18N.n(n, 'win').toUpperCase() });
  const score = x => (Number.isInteger(x) ? String(x) : x.toFixed(1)).replace('.', I18N.lang === 'en' ? '.' : ',');
  const TOPIC_ICON = { geography: '🌍', sports: '⚽', literature: '📚', art: '🎨', movies: '🎬', music: '🎵', science: '🔬', history: '🏛',
    mountains: '⛰', waters: '🏝', athletes: '🏅', clubs: '🏟', writers: '✍️', artists: '🖌', architecture: '🏰', actors: '🎭', series: '📺', cartoons: '🧸', soundtracks: '🎼', musicians: '🎸', albums: '💿', songs: '🎤', scientists: '🧪', space: '🚀', rulers: '👑', games: '🎮', companies: '🏢', nature: '🦁', food: '🍜', universities: '🎓', languages: '🗣' };
  const topicName = k => (TOPIC_ICON[k] || '❓') + ' ' + t('q.t.' + k);
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
  function fitText(node, text) {
    const parent = node.parentElement;
    node.textContent = text;
    node.style.fontSize = '';
    const avail = parent.clientWidth - 20;
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (avail > 0 && node.scrollWidth > avail && size > 8) { size *= 0.92; node.style.fontSize = size + 'px'; }
  }

  // ------------------------------------------------------------ sounds and voice
  const FX = {
    ok() { A.tone(660, 0, 0.1, 'triangle', 0.1, 990); },
    miss() { A.tone(240, 0, 0.12, 'sine', 0.05, 200); },
    gift() { [1568, 2093, 2637, 3136].forEach((f, i) => A.tone(f, i * 0.05, 0.3, 'sine', 0.1)); },
    follow() { A.tone(880, 0, 0.15, 'sine', 0.12); A.tone(1320, 0.1, 0.25, 'sine', 0.12); },
    tick(n) { A.tone(n <= 3 ? 1200 : 900, 0, 0.08, 'square', 0.1); },
    spin() { A.tone(500 + Math.random() * 400, 0, 0.05, 'square', 0.05); },
    stop() { A.tone(784, 0, 0.2, 'square', 0.12); A.tone(1175, 0.12, 0.4, 'square', 0.12); },
    question() { A.tone(660, 0, 0.15, 'triangle', 0.14); A.tone(880, 0.12, 0.25, 'triangle', 0.14); },
    answer() { [523, 659, 784, 1047].forEach((f, i) => A.tone(f, i * 0.08, 0.3, 'triangle', 0.12)); },
    winner() {
      [[523, 0], [659, .15], [784, .3], [1047, .45]].forEach(([f, d]) => { A.tone(f, d, 0.35, 'square', 0.14); A.tone(f / 2, d, 0.35, 'triangle', 0.18); });
      [523, 659, 784, 1047].forEach(f => A.tone(f, 0.65, 1.5, 'sawtooth', 0.06));
      A.noise(0.65, 0.6, 0.25);
    },
    timeout() { A.tone(220, 0, 0.6, 'sawtooth', 0.15, 110); A.tone(233, 0, 0.6, 'square', 0.08, 116); },
    streak(n) { [392, 523, 659, 784, 1047].slice(0, Math.min(5, 2 + n)).forEach((f, i) => A.tone(f, i * 0.09, 0.4, 'sawtooth', 0.08)); },
  };
  let lastBlip = 0;
  function fx(kind, arg) {
    if (!A.ready) return;
    if (kind === 'ok' || kind === 'miss' || kind === 'spin') {   // don't machine-gun blips
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
  const PACE_WINDOW_MS = 10000, PACE_CALM = 1, PACE_BUSY = 4;
  let paceTimes = [], heat = 0;
  const pace = (calm, busy) => calm + (busy - calm) * heat;
  setInterval(() => {
    const now = Date.now();
    paceTimes = paceTimes.filter(x => now - x < PACE_WINDOW_MS);
    const wps = paceTimes.length / (PACE_WINDOW_MS / 1000);
    heat += (Math.min(1, Math.max(0, (wps - PACE_CALM) / (PACE_BUSY - PACE_CALM))) - heat) * 0.3;
  }, 500);

  // ------------------------------------------------------------ the chat line
  // one message at a time, shown for a while that follows the pace; a busy chat drops the old ones
  const tries = []; let trying = false;
  function pushTry(e) {
    paceTimes.push(Date.now());
    tries.push(e);
    while (tries.length > 2) tries.shift();
    if (!trying) nextTry();
  }
  function nextTry() {
    const e = tries.shift();
    trying = !!e;
    if (!e) return;
    const box = $('try');
    box.className = e.kind === 'ok' ? '' : 'miss';
    const left = el('div', 'side'), who = el('div', 'side who');
    if (e.tag) left.append(el('span', 'tag', e.tag));
    left.append(el('span', 'tw', String(e.word || '').toUpperCase()),el('span', 'lab ' + e.kind, t(e.kind === 'ok' ? 'q.inTable' : 'q.noSuch')));
    who.append(avatar(e.name, e.avatar), el('span', '', clean(e.name)));
    const cur = el('div', 'cur'); cur.style.display = 'contents';
    cur.append(left, who);
    box.replaceChildren(cur);
    fx(e.kind);
    const ms = tries.length ? pace(600, 150) : pace(e.kind === 'ok' ? 1100 : 1500, 250);
    setTimeout(() => { if (!tries.length) box.classList.add('fade'); nextTry(); }, ms);
  }
  function idleTry() { $('try').className = ''; $('try').replaceChildren(el('span', 'idle', t('q.idle'))); }

  // ------------------------------------------------------------ the table of variants
  const rowsShown = new Map();                    // variant -> {el, players: Set, more}
  function stack(r) {
    const box = el('span', 'stk');
    const was = rowsShown.get(r.w);
    const known = was ? was.players : null;
    if (!r.players.length && r.seed) {             // the game's own variant nobody chose yet
      box.classList.add('seed');
      box.append(el('span', 'sd', '💡 ' + t('q.seed')));
      return box;
    }
    const list = r.players.length ? r.players : [r.author];
    if (!r.players.length) box.classList.add('left');
    if (list.length === 1) {
      const a = avatar(list[0].name, list[0].avatar);
      if (known && !known.has(list[0].name)) a.classList.add('in');
      box.append(a, el('span', 'n', clean(list[0].name)));
      return box;
    }
    list.forEach((p, i) => {
      const a = avatar(p.name, p.avatar);
      a.style.zIndex = String(list.length - i);   // the first to name it on top
      if (known && !known.has(p.name)) a.classList.add('in');
      box.append(a);
    });
    if (r.n > list.length) {
      const m = el('span', 'more', '+' + (r.n - list.length));
      if (was && was.more !== r.n - list.length) m.classList.add('pop');
      box.append(m);
    }
    return box;
  }
  let tableKey = '';
  function renderTable() {
    const box = $('table');
    const list = (S && S.variants) || [];
    const key = JSON.stringify([S && S.phase, S && S.roundId, S && S.n, list.map(r => [r.w, r.n, r.right, r.players.map(p => p.name + p.avatar)])]);
    if (key === tableKey) return;
    tableKey = key;
    if (!list.length) {
      rowsShown.clear();
      box.replaceChildren(el('div', 'empty', S && S.phase === 'ask' ? t('q.empty') : ''));
      return;
    }
    const next = new Map();
    let seedNo = 0;
    const rows = list.map(r => {
      const was = rowsShown.get(r.w);
      const row = el('div', 'row' + (was ? '' : ' enter') + (r.right ? ' ok' : ''));
      if (!was && r.seed) row.style.animationDelay = (0.3 + 0.35 * seedNo++) + 's';   // the game's variants one by one
      if (was && was.n !== r.n && r.n > was.n) row.classList.add('bump');
      if (r.tag) row.append(el('span', 'tag', r.tag));   // the option's letter: type "АА" or the word
      row.append(el('span', 'wd', String(r.w).toUpperCase()), stack(r));
      next.set(r.w, { players: new Set(r.players.map(p => p.name)), more: Math.max(0, r.n - r.players.length), n: r.n });
      return row;
    });
    rowsShown.clear(); next.forEach((v, k) => rowsShown.set(k, v));
    box.replaceChildren(...rows);
    // only whole rows: one that doesn't fit above the chat zone is not shown
    const limit = box.offsetTop + box.clientHeight;
    [...box.children].forEach(b => { if (b.offsetTop + b.offsetHeight > limit + 1) b.remove(); });
  }
  let tableTimer = 0, tableAt = 0;
  function renderTableSoon() {
    if (!tableTimer) tableTimer = setTimeout(() => { tableTimer = 0; tableAt = Date.now(); renderTable(); }, Math.max(0, tableAt + pace(200, 100) - Date.now()));
  }

  // ------------------------------------------------------------ the question, the answer, the topic roulette
  let qKey = '';
  function renderQuestion(s) {
    const key = s.roundId + '|' + s.n + '|' + (s.question || '') + '|' + (s.topic || '');
    if (key === qKey) return;
    qKey = key;
    $('topic').textContent = s.topic ? topicName(s.topic).toUpperCase() : '';
    $('qtext').textContent = s.question || '';
    const qc = $('qcard'); qc.classList.remove('in'); void qc.offsetWidth; qc.classList.add('in');
    if (s.phase === 'ask') idleTry();
  }
  function renderDots(s) {
    const box = $('dots');
    if (!['topic', 'intro', 'ask', 'answer'].includes(s.phase)) { box.replaceChildren(); return; }
    const n = s.n - (s.phase === 'answer' ? 0 : 0);
    box.replaceChildren(...Array.from({ length: s.of || 0 }, (_, i) =>
      el('i', i + 1 < n || (i + 1 === n && s.phase === 'answer') ? 'done' : i + 1 === n && s.phase !== 'topic' ? 'cur' : '')));
  }
  let scorersKey = '';
  function renderAnswer(s) {
    document.body.classList.toggle('answer', s.phase === 'answer');
    if (s.phase !== 'answer') { scorersKey = ''; return; }
    const key = s.roundId + '|' + s.n;
    if (key === scorersKey) return;
    scorersKey = key;
    $('ansWord').textContent = String(s.answer || '').toUpperCase();
    const box = $('scorers'); box.replaceChildren();
    if (!s.scorers.length) box.append(el('span', 'sc', t('q.nobody')));
    s.scorers.slice(0, 9).forEach((p, i) => {
      const c = el('span', 'sc' + (p.first ? ' first' : ''));
      c.style.animationDelay = (0.25 + i * 0.1) + 's';
      c.append(avatar(p.name, p.avatar), el('span', '', clean(p.name)), el('b', '', '+' + score(p.pts)));
      box.append(c);
    });
    if (s.scorers.length > 9) box.append(el('span', 'sc', t('q.more', { n: s.scorers.length - 9 })));
  }
  // the roulette runs through the round's topics on the page's own clock and stops on the server's choice
  let bigKey = '', spinTimer = 0;
  function renderBig(s) {
    const show = s.phase === 'topic' || s.phase === 'intro';
    $('big').hidden = !show;
    if (!show) { bigKey = ''; clearTimeout(spinTimer); return; }
    const key = s.phase + '|' + s.roundId + '|' + s.n;
    if (key === bigKey) return;
    bigKey = key;
    clearTimeout(spinTimer);
    const v = $('bigV');
    if (s.phase === 'intro') {
      $('bigK').textContent = topicName(s.topic).toUpperCase();
      v.className = 'v stop'; v.textContent = t('q.question', { n: s.n, of: s.of });
      $('bigS').textContent = '';
      fx('question');
      return;
    }
    $('bigK').textContent = t('q.topicK');
    $('bigS').textContent = '';
    const names = (s.topics && s.topics.length > 1 ? s.topics : Object.keys(TOPIC_ICON)).map(topicName);
    const end = Date.now() + Math.max(800, (s.phaseUntil - Live.now()) * 1000 - 1600);
    let i = Math.floor(Math.random() * names.length), gap = 90;
    const spin = () => {
      if (Date.now() >= end) {
        v.className = 'v'; void v.offsetWidth; v.className = 'v stop';
        v.textContent = topicName(s.topic);
        $('bigS').textContent = s.quiz || '';
        fx('stop');
        voice('round', t('q.v.topic', { topic: t('q.t.' + s.topic) }), 'high', 1);
        return;
      }
      v.className = 'v'; void v.offsetWidth; v.className = 'v spin';
      v.textContent = names[i++ % names.length];
      fx('spin');
      gap = Math.min(320, gap * 1.08);
      spinTimer = setTimeout(spin, gap);
    };
    spin();
  }

  // ------------------------------------------------------------ events from the server
  function onEvent(e) {
    const name = clean(e.name), NAME = name.toUpperCase();
    const sname = AudioKit.spokenName(e.name);
    switch (e.type) {
      case 'try': pushTry(e); break;
      case 'round_start':
        voice('round', t('g.v.round', { n: e.round }), 'urgent', 1);
        break;
      case 'answer':
        fx('answer');
        voice('answer', t('q.v.answer', { w: e.word }), 'high', 1);
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
        voice('winner', t('q.v.nobody'), 'high', 1);
        break;
      case 'winner':
        fx('winner');
        voice('winner', t('q.v.winner', { name: sname, points: I18N.n(e.score, 'point') }), 'urgent', 1);
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
    if (ALPHA) root.style.setProperty('--game-bg-top', $('qcard').offsetTop + 'px');   // dark from the question on
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

  // ------------------------------------------------------------ winner / results
  function renderWinner(s) {
    const w = s.winner;
    $('wAvatar').replaceChildren();
    $('wChips').replaceChildren();
    $('wTitle').textContent = t(w ? 'q.w.title' : 'q.w.nobody');
    $('wTitle').className = 'wtitle' + (w ? '' : ' timeout');
    $('wTopic').textContent = s.topic ? topicName(s.topic).toUpperCase() : '';
    if (w) {
      $('wAvatar').append(avatar(w.name, w.avatar));
      fitText($('wName'), w.name);
      $('wSub').textContent = I18N.n(w.score, 'point');
      $('wChips').append(el('span', 'chip', '✅ ' + t('q.w.right', { n: w.right })));
      if ((s.winners || []).length > 1) $('wChips').append(el('span', 'chip', t('q.w.tie', { names: s.winners.slice(1).map(p => clean(p.name)).join(', ') })));
      if (w.streak >= 2) $('wChips').append(el('span', 'chip streak', t('g.w.streak', streakP(w.streak))));
    } else {
      $('wName').textContent = ''; $('wSub').textContent = '';
    }
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
    $('rTopic').textContent = s.topic ? topicName(s.topic).toUpperCase() : '';
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
      l.append(el('span', '', p.name), el('span', '', score(p.score)));
      top.append(l);
    });
    if (!(s.players || []).length) top.append(el('div', 'line', '—'));
    streamLeaders($('rStream'), s.streamLeaderboard);
    streamLeaders($('lStream'), s.streamLeaderboard);
    renderPromo(s.promo || []);
  }

  function render(s) {
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
    renderDots(s);
    renderQuestion(s);
    renderAnswer(s);
    renderBig(s);
    if (s.phase !== 'ask' && s.phase !== 'answer') { tries.length = 0; if (s.phase !== 'intro') idleTry(); }
    if (s.phase === 'answer' || s.phase === 'intro' || s.phase === 'topic') renderTable(); else renderTableSoon();
    $('winner').hidden = s.phase !== 'winner';
    $('reveal').hidden = s.phase !== 'reveal';
    if (s.phase === 'winner') renderWinner(s);
    if (s.phase === 'reveal') renderReveal(s);
    if (s.phase === 'ask') tickerFor(s);
  }

  // ------------------------------------------------------------ ticker at the CTA line
  let tickerRound = null, tickerTimers = [];
  function tickerText(s) {
    const parts = [], lr = s.lastRound;
    if (lr && lr.winner) parts.push('🏆 ' + t('q.tk.winner', { name: esc(lr.winner), points: I18N.n(lr.score || 0, 'point') }));
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
    const html = custom || (S && S.phase === 'ask' && tickerText(S)), box = $('ticker');
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
  function tickerFor(s) {                          // once per round, at its first question
    if (s.roundId === tickerRound || s.n !== 1) return;
    tickerRound = s.roundId;
    tickerTimers.forEach(clearTimeout);
    tickerTimers = [8].map(at => setTimeout(runTicker, at * 1000));
  }

  // ------------------------------------------------------------ clock: the question's timer, the last 5 s, the break
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
    if (S.hostPaused) {
      timerEl.textContent = '⏸ ' + (S.phase === 'ask' ? fmtClock(S.pausedLeft || 0) : '');
      timerEl.classList.remove('low');
      bigNum('⏸', 'cd');
      return;
    }
    if (S.phase === 'ask') {
      const left = Math.max(0, Math.ceil(S.endsAt - now));
      timerEl.textContent = fmtClock(left);
      timerEl.classList.toggle('low', left <= 5);
      if (left <= 5 && left > 0) {
        if (lastBig !== String(left)) fx('tick', left);
        bigNum(String(left), 'final');
      } else bigNum('');
      return;
    }
    timerEl.classList.remove('low');
    timerEl.textContent = S.phase === 'answer' ? '0:00' : fmtClock(S.qtime || 0);
    bigNum('');
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
  }
  setInterval(clock, 150);

  // ------------------------------------------------------------ rules + start
  function showRules(ms) {
    $('rules').hidden = false;
    clearTimeout(showRules.t);
    showRules.t = setTimeout(() => { $('rules').hidden = true; }, ms || 8000);
  }
  $('rules').onclick = () => { $('rules').hidden = true; };
  A.mount({ rules: () => ($('rules').hidden ? showRules(12000) : ($('rules').hidden = true)), hello: 'q.v.hello', helloRate: 1 });
  showRules(7000);
  Balloons.mount({ ground: true, area: $('stage'), bottom: 'calc(var(--u) * 26)', width: 'calc(var(--u) * 20)', sound: true });
  const cakeAt = () => {
    const cam = document.documentElement.classList.contains('chroma') && $('chromaZone').offsetHeight / $('stage').offsetHeight;
    return { sound: true, root: $('stage'), skyBottom: cam ? cam * .85 : undefined };
  };
  // gifts here only launch the animations every page has (hints, boosts... are Guess the Word's)
  const ANIMATIONS = ['balloon', 'plane', 'bomber', 'snowball', 'cake'];
  Live.start({ game: 'quiz', onState: (s, msg) => { tgBot = msg.tgBot || ''; promos = (msg.giftPromos || []).filter(p => ANIMATIONS.includes(p.action)); render(s); Balloons.render(msg.balloons);
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
