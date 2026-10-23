// Guess the Word overlay. All user text goes through textContent (no HTML injection).
(() => {
  const $ = id => document.getElementById(id);
  const A = AudioKit, t = I18N.t;
  const fmt = n => Number(n).toLocaleString(I18N.locale);   // 22,344 / 22 344
  const clean = n => (n || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim() || 'Someone';
  const tKey = s => (s || '').toLowerCase().replace(/\s/g, '');
  // streak params: {n} for English, {wins} = "2 победы" / {winsUp} = "2 ПОБЕДЫ" (Russian plural forms)
  const streakP = n => ({ n, wins: I18N.n(n, 'win'), winsUp: I18N.n(n, 'win').toUpperCase() });
  let S = null;                       // last state
  let hintUntil = 0, hintTimer = null;  // the hint card is shown for 3 s
  let vocab = 30000;

  // Put text into a big headline and shrink the font until it fits its container's width
  // (long words like APPLICATION on the winner / reveal screens). Re-measures only on change.
  function fitText(node, text) {
    const parent = node.parentElement;
    const key = text + '|' + parent.clientWidth;
    if (node.dataset.fit === key) return;
    node.dataset.fit = key;
    node.textContent = text;
    node.style.fontSize = '';
    node.style.display = 'inline-block';
    node.style.whiteSpace = 'nowrap';
    node.style.maxWidth = 'none';
    const anim = node.style.animation;
    node.style.animation = 'none';                       // measure without the letter-spacing intro
    const cs = getComputedStyle(parent);
    const avail = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (avail > 0 && node.scrollWidth > avail && size > 8) {
      size *= 0.92;
      node.style.fontSize = size + 'px';
    }
    node.style.animation = anim;
  }

  // Same for a fixed-width cell (word in BEST GUESSES); the fitted size is cached per word.
  const cellSize = new Map();
  function fitCell(node) {
    const key = node.textContent + '|' + node.clientWidth;
    if (cellSize.has(key)) { node.style.fontSize = cellSize.get(key); return; }
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (node.clientWidth > 0 && node.scrollWidth > node.clientWidth && size > 8) {
      size *= 0.92;
      node.style.fontSize = size + 'px';
    }
    cellSize.set(key, node.style.fontSize);
    if (cellSize.size > 500) cellSize.clear();
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  // avatar <img> or a colored initial when TikTok gives none / it fails to load
  function avatar(name, url) {
    const hue = [...(name || '?')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const fallback = () => {
      const d = el('span', 'av', (clean(name)[0] || '?').toUpperCase());
      d.style.background = `hsl(${Chroma.hue(hue)} 90% 60%)`;   // no green in chroma key mode
      return d;
    };
    if (!url || !/^https:\/\//.test(url)) return fallback();
    const img = el('img', 'av');
    img.referrerPolicy = 'no-referrer'; img.alt = ''; img.src = url;
    img.onerror = () => img.replaceWith(fallback());
    return img;
  }
  // non-linear closeness: #2 >> #20 >> #200 >> #2000
  const closeness = r => Math.max(0.03, 1 - Math.log(Math.max(1, r)) / Math.log(vocab));

  // ------------------------------------------------------------ sounds
  const FX = {
    guess(temp) {                        // blip, hotter = higher
      const f = { perfect: 1320, burning: 1046, veryhot: 880, hot: 740, warm: 587, cold: 440, freezing: 330 }[temp] || 500;
      A.tone(f, 0, 0.12, 'triangle', 0.12, f * 1.25);
    },
    leader() { A.tone(330, 0, 0.35, 'sawtooth', 0.08, 1320); A.tone(1320, 0.3, 0.2, 'sine', 0.2); A.tone(1760, 0.42, 0.35, 'sine', 0.18); },
    close(level) {                       // rising arpeggio, longer when closer
      const n = { so_close: 6, top3: 5, top10: 4, top50: 3, top100: 2 }[level] || 3;
      for (let i = 0; i < n; i++) A.tone(523 * Math.pow(1.26, i), i * 0.07, 0.22, 'square', 0.09);
    },
    jump(kind) { A.tone(200, 0, kind === 'massive' ? 0.5 : 0.3, 'sawtooth', 0.12, kind === 'massive' ? 2400 : 1200); A.noise(0, 0.25, 0.15); },
    gift() { [1568, 2093, 2637, 3136].forEach((f, i) => A.tone(f, i * 0.05, 0.3, 'sine', 0.1)); },
    follow() { A.tone(880, 0, 0.15, 'sine', 0.12); A.tone(1320, 0.1, 0.25, 'sine', 0.12); },
    hint() { for (let i = 0; i < 8; i++) A.tone(880 + i * 180, i * 0.04, 0.2, 'sine', 0.07); },
    tick(n) { A.tone(n <= 3 ? 1200 : 900, 0, 0.08, 'square', 0.1); },
    count(go) { go ? A.tone(1320, 0, 0.45, 'square', 0.16) : A.tone(660, 0, 0.18, 'square', 0.14); },
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
    if (kind === 'guess') {               // don't machine-gun blips
      const now = performance.now(); if (now - lastBlip < 90) return; lastBlip = now;
    }
    FX[kind](arg);
  }
  // voice: important moments only; low-priority lines are skipped while speaking
  // key phrases (round start, winner and the word) at normal speed (rate 1), the rest at VOICE_RATE
  function voice(id, text, prio, rate) {
    if (!A.ready || !Toasts.voice(id)) return;
    rate = Toasts.rate(id, rate);
    if (prio === 'urgent') A.say(text, { urgent: true, excited: true, rate });
    else if (prio === 'high' || !A.speaking) A.say(text, { excited: true, rate });
  }

  // ------------------------------------------------------------ the chat's pace
  // words guessed in the last PACE_WINDOW_MS -> heat 0 (calm, under PACE_CALM words/s) .. 1 (busy, PACE_BUSY+),
  // smoothed so timings change gradually. Every animation setting is the fastest it gets at heat 1;
  // calm, it's smooth (CALM_ANIM s).
  const PACE_WINDOW_MS = 10000, PACE_CALM = 1, PACE_BUSY = 4, CALM_ANIM = 0.5;
  let paceTimes = [], heat = 0;
  const lerp = (a, b, k) => a + (b - a) * k;
  function countWords(n) { const now = Date.now(); for (let i = 0; i < n; i++) paceTimes.push(now); }
  setInterval(() => {
    const now = Date.now();
    paceTimes = paceTimes.filter(t => now - t < PACE_WINDOW_MS);
    const wps = paceTimes.length / (PACE_WINDOW_MS / 1000);
    heat += (Math.min(1, Math.max(0, (wps - PACE_CALM) / (PACE_BUSY - PACE_CALM))) - heat) * 0.3;
    applyTable();
  }, 500);
  // a toast's in/out animation (s): its setting is the floor ("auto" or none = 0.1), calm it's CALM_ANIM
  function toastAnim(id) {
    const a = id && Toasts.cfg[id] && Toasts.cfg[id].anim;
    const floor = typeof a === 'number' ? a : 0.1;
    return lerp(Math.max(CALM_ANIM, floor), floor, heat);
  }
  // the table: a new row slides in (its setting = the floor at the busiest, calm CALM_ANIM) and stays on top
  // freshMs() (calm 1 s, busy FRESH_MS)
  const freshMs = () => lerp(1000, FRESH_MS, heat);
  function applyTable() {
    if (!S) return;
    const floor = S.rowAnim ?? 0.2;
    document.documentElement.style.setProperty('--row-anim', lerp(Math.max(CALM_ANIM, floor), floor, heat).toFixed(2) + 's');
  }

  // ------------------------------------------------------------ big toasts (queued, 1-3 s)
  // a busy chat: a toast that waited too long is old news - skipped (except "keep": hints, words to
  // pick...); the one on screen gives way to the next one after TOAST_MIN_MS (unless it is "keep")
  const queue = []; let showing = null, toastTimer = 0;
  const TOAST_STALE_MS = 2500, TOAST_MIN_MS = 800;
  function toast(head, sub, color, opts) {
    opts = opts || {};
    if (opts.id && !Toasts.show(opts.id)) return;
    if (queue.length >= 3) queue.splice(queue.findIndex(q => !q.important), 1);   // drop the least important
    const item = { head, sub, color, id: opts.id, huge: opts.huge, important: opts.important, keep: opts.keep,
                   hold: opts.hold || 1.2, at: Date.now() };
    if (opts.now) {                         // priority (a hint): first in line, replaces what is on screen
      queue.unshift(item);
      nextToast();
      return;
    }
    queue.push(item);
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
    const anim = toastAnim(item.id);
    c.style.setProperty('--t-in', anim + 's');
    c.style.setProperty('--t-out', Math.min(anim, 0.3) + 's');
    c.append(el('div', 'h', item.head));
    if (item.sub) c.append(el('div', 's', item.sub));
    $('toast').replaceChildren(c);
    c.querySelectorAll('.h').forEach(n => fitText(n, n.textContent));   // the name fits one line; the event text wraps
    toastTimer = setTimeout(nextToast, (queue.length && !item.keep ? TOAST_MIN_MS : (item.hold + 0.4) * 1000));
  }
  function mini(text, cls, id) {
    if (id && !Toasts.show(id)) return;
    const m = el('div', 'mini ' + (cls || ''), text);
    m.style.setProperty('--m-in', toastAnim(id) + 's');
    const box = $('miniToasts');
    box.appendChild(m);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(() => m.remove(), 2900);
  }

  // hint text in the current language (server sends the type + word/number)
  function hintText(e) {
    const kind = e.kind || e.type;
    if (kind === 'length') return { text: t('g.h.length'), word: I18N.n(e.n || 0, 'letter') };
    if (kind === 'distance') return { text: t('g.h.distance', { n: e.n }), word: e.word };
    return { text: t('g.h.' + kind), word: e.word };
  }

  // ------------------------------------------------------------ events from the server
  function onEvent(e) {
    const name = clean(e.name), NAME = name.toUpperCase();
    const sname = AudioKit.spokenName(e.name);          // for the voice: "_катрин_" -> "катрин"
    switch (e.type) {
      case 'guess': countWords(1); fx('guess', tKey(e.temp)); addFresh(e); break;
      case 'multi_guess': {                 // several words in one comment: one row, then each flies to its place
        const best = e.words.filter(w => !w.unknown).sort((a, b) => a.rank - b.rank)[0];
        if (best) fx('guess', tKey(best.temp));
        countWords(e.words.length);
        addMulti(e);
        break;
      }
      case 'new_leader':
        fx('leader');
        toast(NAME, t(e.comeback ? 'g.t.comeback' : 'g.t.leader'), 'var(--magenta)', { important: true, id: 'leader' });
        voice('leader', t(e.comeback ? 'g.v.comeback' : 'g.v.leader', { name: sname }));
        break;
      case 'jump':
        fx('jump', e.kind);
        if (e.kind === 'massive') {
          toast(NAME, t('g.t.massive'), 'var(--lime)', { huge: true, important: true, hold: 2, id: 'jump' });
          voice('jump', t('g.v.massive', { name: sname }));
        } else toast(NAME, t('g.t.big'), 'var(--lime)', { id: 'jump' });
        break;
      case 'close':
        fx('close', e.level);
        if (e.level === 'so_close') {
          toast(NAME, t('g.t.soClose'), 'var(--pink)', { huge: true, important: true, hold: 2.2, id: 'so_close' });
          voice('so_close', t('g.v.soClose', { name: sname }), 'high');
        } else if (e.level === 'top3') {
          toast(NAME, t('g.t.top3'), 'var(--orange)', { important: true, id: 'top' });
          voice('top', t('g.v.top3', { name: sname }));
        } else if (e.level === 'top10') {
          toast(NAME, t('g.t.top10'), 'var(--orange)', { id: 'top' });
        } else {
          mini(t('g.t.reached', { name, n: e.level === 'top50' ? 50 : 100 }), 'small', 'top');
        }
        break;
      case 'streak':
        fx('streak', e.n);
        toast(NAME, t('g.t.streak', streakP(e.n)), 'var(--orange)', { huge: e.n >= 3, important: true, hold: e.n >= 5 ? 2.8 : 2, id: 'streak' });
        voice('streak', t('g.v.streak', Object.assign(streakP(e.n), { name: sname })), 'high');
        break;
      case 'mao_call': {                          // a leader calls the host: red ticker + 3x high voice
        const line = t('g.tk.mao', { name: clean(e.name) });
        queueTicker('<span class="alarm">' + esc(line) + '</span>');
        for (let i = 0; i < 3; i++) A.say(line, { pitch: 2, rate: 1.3 });   // volume is already the max (1)
        break;
      }
      case 'credits_info':                       // "мои подсказки": on the ticker line
        queueTicker(t('g.tk.credits', { name: esc(e.name), hints: I18N.n(e.n || 0, 'hint') }));
        break;
      case 'tg_info':                            // "настроить связь": the bot and the stream word
        toast('📲 ' + (e.bot ? '@' + e.bot : ''), t('g.t.tgWord', { w: clean(e.word) }), '#2aabee', { important: true, keep: true, hold: 6, id: 'tg_word' });
        queueTicker(t('g.tk.tg', { bot: esc(e.bot ? '@' + e.bot : ''), w: esc(e.word) }));
        break;
      case 'custom_word':                        // a viewer picked this round's word (via the bot)
        toast('🎯 ' + clean(e.name), t('g.t.customWord'), 'var(--orange)', { important: true, keep: true, hold: 5, id: 'custom_word' });
        queueTicker(t('g.tk.custom', { name: esc(clean(e.name)) }));
        break;
      case 'custom_ticker':
        queueTicker(t('g.tk.custom', { name: esc(clean(e.name)) }));
        break;
      case 'tg_linked':
        mini(t('g.t.tgLinked', { name }), 'follow', 'tg_linked');
        break;
      case 'hint_wait':
        mini(t('g.t.hintWait', { name, s: e.seconds }), 'gift', 'hint_wait');
        break;
      case 'steal':                       // a gift bought the win: the winner card follows at once
        fx('winner');
        toast(NAME, t('g.t.steal'), 'var(--yellow)', { huge: true, important: true, keep: true, now: true, hold: 2.4, id: 'steal' });
        break;
      case 'boost':
        fx('gift');
        mini(t('g.t.boost', { name }), 'gift', 'boost');
        break;
      case 'gift':
        fx('gift');
        mini(t('g.t.gift', { name, gift: clean(e.gift) }) + (e.count > 1 ? ' ×' + e.count : ''), 'gift', 'gift');
        break;
      case 'follow':
        fx('follow');
        mini(t('g.t.followed', { name }), 'follow', 'thanks');
        break;
      case 'follow_needed':
        if (e.dq) mini(t('g.t.followToPlay', { name }), 'follow', 'follow_needed');
        else {
          mini(t('g.t.followNeeded', { name, n: e.seconds }), 'follow', 'follow_needed');
          voice('follow_needed', t('g.v.followNeeded', { name: sname }), 'high', 1);
        }
        break;
      case 'found_pending':
        fx('close', 'so_close');
        toast(NAME, t('g.t.foundPending') + ' ' + t('g.t.foundPendingSub', { n: e.seconds }), 'var(--magenta)', { huge: true, important: true, keep: true, hold: 2.6, id: 'found_pending' });
        voice('found_pending', t('g.v.foundPending', { name: sname }), 'high', 1);
        break;
      case 'follow_ok':
        fx('follow');
        toast(NAME, t('g.t.thanks') + ' ' + t('g.t.thanksSub'), 'var(--violet)', { important: true, id: 'thanks' });
        voice('thanks', t('g.v.thanks', { name: sname }), 'high', 1);
        break;
      case 'dq':
        fx('timeout');
        toast(NAME, t('g.t.sorry') + ' ' + t('g.t.sorrySub'), 'var(--pink)', { important: true, keep: true, hold: 2.4, id: 'dq' });
        voice('dq', t('g.v.sorry', { name: sname }), 'high', 1);
        break;
      case 'unknown':                     // grey, under the table for a moment: the player sees it was read
        countWords(1);
        showUnknown(e);
        break;
      case 'hint': {
        fx('hint');
        const h = hintText(e);
        toast(t('g.hint'), (h.text + ' ' + h.word).trim(), 'var(--yellow)', { important: true, keep: true, now: true, hold: 2.4, id: 'hint' });
        voice('hint', t('g.v.hint', { text: h.text, word: h.word.toLowerCase() }), 'high');
        break;
      }
      case 'timeout':
        fx('timeout');
        toast(t(e.reason === 'skip' ? 'g.t.skipped' : 'g.t.timeUp'), '', 'var(--orange)', { huge: true, important: true, keep: true, hold: 1.4, id: 'time_up' });
        voice('time_up', t(e.reason === 'skip' ? 'g.v.skipped' : 'g.v.timeUp'), 'urgent');
        break;
      case 'winner': {
        fx('winner');
        if (!e.word) break;                       // a viewer's word nobody found: not said aloud
        const word = e.word.toLowerCase();
        if (e.stolen) voice('steal', t('g.v.steal', { name: sname, word }), 'urgent', 1);
        else if (e.reason === 'exact') voice('winner', t('g.v.winner', { name: sname, word }), 'urgent', 1);
        else if (e.name) voice('winner', t('g.v.closest', { name: sname, word }), 'high', 1);
        else voice('winner', t('g.v.nobody', { word }), 'high', 1);
        break;
      }
      case 'round_start':
        voice('round', e.roundType === 'speed' ? t('g.v.speed') : t('g.v.round', { n: e.round }), 'urgent', 1);
        break;
    }
  }

  // ------------------------------------------------------------ render state
  let prevWords = new Map(), prevHunters = new Map(), prevHintCount = 0;

  function renderHunters(list) {
    const box = $('hunterList');
    box.replaceChildren();
    if (!list.length) { box.append(el('li', 'hrow empty', t('g.noHunters'))); return; }
    const medals = ['🥇', '🥈', '🥉', '4', '5'];
    list.forEach((h, i) => {
      const li = el('li', 'hrow' + (h.leader ? ' leader' : ''));
      const before = prevHunters.get(h.name);
      if (before && h.rank < before) li.classList.add('up');
      const nm = el('span', 'nm');
      nm.append(el('span', 'n', h.name));
      if (h.pendingUntil) {                      // not following yet: countdown to keep the spot
        li.classList.add('pending');
        const fw = el('span', 'fw');
        fw.dataset.until = h.pendingUntil;
        nm.append(fw);
      }
      li.append(el('span', 'pos', medals[i]), avatar(h.name, h.avatar), nm,
                el('span', 'rk t-' + h.tempKey, '#' + fmt(h.rank)));
      box.append(li);
    });
    prevHunters = new Map(list.map(h => [h.name, h.rank]));
  }

  const isHintWord = w => ((S && S.hints) || []).some(h => h.type === 'semantic' && h.word === w);
  function guessRow(g, cls) {
    // one line: [ proximity bar behind (rank  WORD) ] [avatar name +N]
    const row = el('div', 'grow ' + (cls || ''));
    row.dataset.word = g.word;
    row.dataset.badge = t(g.unknown ? 'g.badgeUnknown' : 'g.badgeNew');
    const main = el('div', 'main');
    const bar = el('i', 'bar t-' + g.tempKey);
    const who = el('div', 'who');
    who.append(avatar(g.name, g.avatar), el('span', 'n', g.name));
    if (g.pendingUntil) {                       // not following yet: countdown to follow
      row.classList.add('pending');
      const fw = el('span', 'fw'); fw.dataset.until = g.pendingUntil; fw.dataset.short = '1';
      who.append(fw);
    } else if (g.count > 1) who.append(el('span', 'cnt', t('g.more', { n: g.count - 1 })));
    if (g.unknown) {
      row.classList.add('unknown');
      main.append(el('span', 'rk', '?'), el('span', 'wd', g.word), el('span', 'note', t('g.notInDict')));
    } else {
      bar.style.width = Math.round(closeness(g.rank) * 100) + '%';
      const rk = el('span', 'rk t-' + g.tempKey, fmt(g.rank));
      if (isHintWord(g.word)) rk.append(el('span', 'hk', '💡'));     // came as a hint: right after the rank
      main.append(bar, rk, el('span', 'wd', g.word));
    }
    row.append(main, who);
    return row;
  }

  // Closest words sorted by rank: a good guess stays on top until someone beats it.
  // A brand-new guess is shown on top for FRESH_MS ("NEW"), then drops to its place by rank
  // (or leaves the list if it isn't among the best).
  const FRESH_MS = 50, MAX_FRESH = 5, MULTI_MS = 800, CHIP_MIN_FONT = 0.8;
  let fresh = [], lastBest = [], multiSeq = 0;
  function addFresh(e, ttl) {
    fresh = fresh.filter(f => f.multi || f.word !== e.word);
    fresh.unshift({ word: e.word, rank: e.rank, temp: e.temp, tempKey: tKey(e.temp), count: e.count || 1,
                    name: e.name, avatar: e.avatar, at: Date.now(), ttl: ttl || freshMs(), unknown: !!e.unknown });
    fresh = fresh.slice(0, MAX_FRESH);
    renderGuesses(lastBest);
  }
  // a word not in the dictionary: one extra grey row right under the table (over the chat zone) for
  // UNKNOWN_MS - the table itself doesn't move
  const UNKNOWN_MS = 200;
  let unknownRow = null, unknownTimer = 0;
  function showUnknown(e) {
    if (unknownRow) unknownRow.remove();
    clearTimeout(unknownTimer);
    const panel = $('recent').getBoundingClientRect();
    const pad = parseFloat(getComputedStyle($('recent')).paddingLeft);
    unknownRow = guessRow({ word: e.word, unknown: true, name: e.name, avatar: e.avatar }, 'unknown-line');
    Object.assign(unknownRow.style, { left: panel.left + pad + 'px', width: panel.width - 2 * pad + 'px', top: panel.bottom + 'px' });
    document.body.append(unknownRow);
    unknownRow.querySelectorAll('.wd').forEach(fitCell);
    unknownTimer = setTimeout(() => { unknownRow && unknownRow.remove(); unknownRow = null; }, UNKNOWN_MS);
  }
  // several words at once: [chip chip chip] + the player on the right, each chip in its rank's color
  function addMulti(e) {
    fresh.unshift({ multi: true, key: 'm' + (++multiSeq), name: e.name, avatar: e.avatar, at: Date.now(), ttl: MULTI_MS,
                    words: e.words.map(w => Object.assign({}, w, { tempKey: w.unknown ? '' : tKey(w.temp) })) });
    fresh = fresh.slice(0, MAX_FRESH);
    renderGuesses(lastBest);
  }
  function multiRow(m) {
    const row = el('div', 'grow fresh multi' + (m.shown ? '' : ' new'));
    row.dataset.key = m.key;
    row.dataset.badge = t('g.badgeNew');
    const main = el('div', 'main chips');
    m.words.forEach(w => {
      const c = el('span', 'chip' + (w.unknown ? ' unknown' : ''));
      c.dataset.word = w.word;
      if (!w.unknown) c.style.background = 'var(--t-' + w.tempKey + ')';
      c.append(el('span', 'cw', w.word));      // no rank number here: the color says it, the table row shows it
      main.append(c);
    });
    const who = el('div', 'who');
    who.append(avatar(m.name, m.avatar), el('span', 'n', m.name));
    row.append(main, who);
    return row;
  }
  // the row's time is up: every chip flies to its word's row in the table (or falls and fades out
  // when the word is not in the visible table / not in the dictionary)
  function flyChips(rects) {
    rects.forEach(({ chip, from, word }) => {
      const fl = chip.cloneNode(true);
      fl.classList.add('flyer');
      Object.assign(fl.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px' });
      document.body.append(fl);
      const target = word && $('guessList').querySelector('.grow[data-word="' + CSS.escape(word) + '"]:not(.fresh)');
      if (target) target.style.visibility = 'hidden';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (target) {
          const to = target.getBoundingClientRect();
          fl.style.transform = `translate(${to.left - from.left}px, ${to.top + (to.height - from.height) / 2 - from.top}px)`;
        } else {
          fl.style.transform = `translate(0, ${from.height * 4}px)`; fl.style.opacity = '0';
        }
        setTimeout(() => {
          fl.remove();
          if (target) { target.style.visibility = ''; target.classList.add('landed'); }
        }, 450);
      }));
    });
  }
  // stream champions (chroma / TT mode): one line per place - avatar + nick when alone, overlapping
  // avatars when tied (like TikTok's viewers), wins, medal
  let champsKey = '', tgBot = '';
  // what the stream's gifts do (the room's gift rules): every PROMO_EVERY a series - each gift in turn for
  // PROMO_SHOW (its picture and the action: "Hint", "Butterflies", "Win!"...), then a pause till the next series
  const PROMO_FIRST = 30000, PROMO_EVERY = 180000, PROMO_SHOW = 10000, PROMO_GAP = 600;
  let promos = [];
  const promoEl = el('div', 'giftpromo');
  function promoSeries() {
    const start = Date.now(), items = Toasts.show('promo') ? promos.slice() : [];
    items.forEach((p, i) => setTimeout(() => showPromo(p), i * (PROMO_SHOW + PROMO_GAP)));
    const end = start + items.length * (PROMO_SHOW + PROMO_GAP);
    setTimeout(promoSeries, Math.max(start + PROMO_EVERY, end + 10000) - Date.now());   // a long series: never overlaps
  }
  function showPromo(p) {
    const name = I18N.lang === 'ru' && p.ru ? p.ru : p.gift;
    const sub = p.rule.startsWith('gift:') ? name : p.rule === 'any' ? t('g.promo.any') : t('g.promo.min', { n: p.coins });
    promoEl.replaceChildren();
    if (p.images.length > 1) {
      const st = el('span', 'stack');
      p.images.forEach(src => { const i = el('img'); i.src = src; i.referrerPolicy = 'no-referrer'; st.append(i); });
      promoEl.append(st);
    } else if (p.images.length) {
      const i = el('img'); i.src = p.images[0]; i.referrerPolicy = 'no-referrer'; promoEl.append(i);
    } else promoEl.append(el('span', 'gi', '🎁'));
    const txt = el('span', 'tx', t('g.promo.' + p.action));
    txt.append(el('small', '', sub));
    promoEl.append(txt);
    promoEl.classList.add('on');
    setTimeout(() => promoEl.classList.remove('on'), PROMO_SHOW);
  }
  setTimeout(promoSeries, PROMO_FIRST);
  function renderChamps(groups) {
    const box = $('champs');
    const key = JSON.stringify([groups, tgBot]);
    if (key === champsKey) return;
    champsKey = key;
    box.replaceChildren();
    box.append(promoEl);                                           // what the gifts do: above the bot's name
    if (tgBot) box.append(el('div', 'tgbot', '📲 @' + tgBot));     // the bot's name, readable above the champions
    groups.forEach((g, i) => {
      const row = el('div', 'champ');
      if (g.n === 1) {
        row.append(avatar(g.players[0].name, g.players[0].avatar), el('span', 'cn', g.players[0].name));
      } else {
        const stack = el('span', 'stack');
        g.players.slice(0, 3).forEach(p => stack.append(avatar(p.name, p.avatar)));
        if (g.n > 3) stack.append(el('span', 'more', '+' + (g.n - 3)));
        row.append(stack);
      }
      row.append(el('span', 'cw', String(g.wins)), el('span', 'cm', ['🥇', '🥈', '🥉'][i]));
      box.append(row);
    });
    sideColumns();
  }

  // top likers (chroma / TT mode), left side mirrored: icon, count, avatar(s), nick when alone
  let likersKey = '';
  function renderLikers(l) {
    const rows = l ? [...(l.planes || []).map(g => ['✈️', g]), ...(l.balloon ? [['🎈', l.balloon]] : [])] : [];
    const key = JSON.stringify(rows);
    if (key !== likersKey) {
      likersKey = key;
      const box = $('likers');
      box.replaceChildren();
      rows.forEach(([icon, g]) => {
        const row = el('div', 'champ liker');
        row.append(el('span', 'cm', icon), el('span', 'cw', String(g.count)));
        if (g.n === 1) {
          row.append(avatar(g.players[0].name, g.players[0].avatar), el('span', 'cn', g.players[0].name));
        } else {
          const stack = el('span', 'stack');
          g.players.slice(0, 3).forEach(p => stack.append(avatar(p.name, p.avatar)));
          if (g.n > 3) stack.append(el('span', 'more', '+' + (g.n - 3)));
          row.append(stack);
        }
        box.append(row);
      });
    }
    sideColumns();
  }
  // popups at the bottom of the camera zone go above both side columns (champions, likers)
  function sideColumns() {
    const h = Math.max($('champs').offsetHeight, $('likers').offsetHeight);
    document.documentElement.style.setProperty('--cols-h', (h ? h + 6 : 0) + 'px');
  }

  function renderGuesses(best) {
    lastBest = best;
    const now = Date.now();
    const box = $('guessList');
    const flying = [];                        // chips of the multi rows whose time is up, measured before redraw
    fresh.filter(f => f.multi && now - f.at >= f.ttl).forEach(m => {
      const row = box.querySelector('.grow.multi[data-key="' + m.key + '"]');
      if (row) row.querySelectorAll('.chip').forEach(chip =>
        flying.push({ chip, from: chip.getBoundingClientRect(), word: chip.classList.contains('unknown') ? '' : chip.dataset.word }));
    });
    fresh = fresh.filter(f => now - f.at < f.ttl);
    box.replaceChildren();
    if (!best.length && !fresh.length) { box.append(el('div', 'empty-hint', t('g.noGuesses'))); return; }
    const mark = g => {
      const before = prevWords.get(g.word);
      return before === undefined ? 'new' : g.count > before ? 'more' : '';
    };
    fresh.forEach(f => {
      box.append(f.multi ? multiRow(f) : guessRow(f, 'fresh' + (f.shown ? '' : ' new'))); f.shown = true;
    });
    // words still in a multi row join the table only when they land
    const shown = new Set(fresh.flatMap(f => f.multi ? f.words.map(w => w.word) : [f.word]));
    best.filter(g => !shown.has(g.word)).slice(0, 18 - fresh.length).forEach(g => box.append(guessRow(g, mark(g))));
    box.querySelectorAll('.wd').forEach(fitCell);                 // long words shrink to fit
    // only whole rows: the table ends above the chat zone, a row that doesn't fit is not shown at all
    const limit = $('recent').getBoundingClientRect().bottom - parseFloat(getComputedStyle($('recent')).paddingBottom);
    [...box.children].forEach(r => { if (r.getBoundingClientRect().bottom > limit + 1) r.remove(); });
    // all chips of a multi row stay visible: the font shrinks down to CHIP_MIN_FONT of its size (smaller
    // letters can't be read on the stream anyway), then long words are cut with "…" - the rank and its
    // color always stay whole
    box.querySelectorAll('.main.chips').forEach(m => {
      const base = parseFloat(getComputedStyle(m.firstChild).fontSize);
      let size = base;
      while (m.clientWidth > 0 && m.scrollWidth > m.clientWidth && size * 0.92 >= base * CHIP_MIN_FONT) {
        size *= 0.92;
        m.querySelectorAll('.chip').forEach(c => { c.style.fontSize = size + 'px'; });
      }
      if (m.scrollWidth > m.clientWidth) m.classList.add('squeeze');
    });
    prevWords = new Map(best.map(g => [g.word, g.count]));
    if (flying.length) flyChips(flying);
  }
  setInterval(() => {                       // let expired "NEW" rows drop into place
    if (fresh.some(f => Date.now() - f.at >= f.ttl)) renderGuesses(lastBest);
  }, 25);                                   // often: a NEW row lives only FRESH_MS (at the busiest)

  let taglineI = 0, taglineT = 0;
  function tagline(s) {
    const lines = [];
    if (s.leader) lines.push(t('g.tag.beat', { name: s.leader.name, rank: fmt(s.leader.rank) }));
    if (s.stats.top100 >= 2) lines.push(t('g.tag.top100', { players: I18N.n(s.stats.top100, 'player') }));
    if (s.streak) lines.push(t('g.tag.streak', Object.assign(streakP(s.streak.n), { name: s.streak.name })));
    if (s.stats.guesses) lines.push(t('g.tag.count', { guesses: I18N.n(s.stats.guesses, 'guess') }));
    if (!lines.length) lines.push(t('g.tag.default'));
    const now = Date.now();
    if (now - taglineT > 5000) { taglineI++; taglineT = now; $('tagline').classList.remove('swap'); void $('tagline').offsetWidth; $('tagline').classList.add('swap'); }
    $('tagline').textContent = lines[taglineI % lines.length];
  }

  function renderWinner(s) {
    const w = s.winner;
    const title = $('wTitle');
    $('wAvatar').replaceChildren();
    $('wChips').replaceChildren();
    if (w && w.reason === 'exact') {
      title.textContent = t('g.w.title'); title.className = 'wtitle';
    } else {
      title.textContent = t(w ? 'g.w.timeout' : 'g.w.nobody'); title.className = 'wtitle timeout';
    }
    if (w) {
      $('wAvatar').append(avatar(w.name, w.avatar));
      fitText($('wName'), w.name);
      $('wSub').textContent = t(w.reason === 'exact' ? 'g.w.found' : 'g.w.closest');
      const chips = ['⏱ ' + Math.floor(w.seconds / 60) + ':' + String(w.seconds % 60).padStart(2, '0'),
                     '🎯 ' + I18N.n(w.guesses, 'guess'), t('g.w.best', { n: fmt(w.best) })];
      chips.forEach(c => $('wChips').append(el('span', 'chip', c)));
      if (w.streak >= 2) $('wChips').append(el('span', 'chip streak', t('g.w.streak', streakP(w.streak))));
    } else {
      $('wName').textContent = ''; $('wSub').textContent = t(s.secretWord ? 'g.w.was' : 'g.w.notFound');
    }
    fitText($('wWord'), s.secretWord || '');
  }

  function renderReveal(s) {
    fitText($('rWord'), s.secretWord || '');
    const pod = $('podium'); pod.replaceChildren();
    const order = [1, 0, 2];                         // 2nd, 1st, 3rd
    order.forEach(i => {
      const p = s.podium[i];
      if (!p) return;
      const col = el('div', 'pcol p' + (i + 1));
      col.append(avatar(p.name, p.avatar), el('div', 'nm', p.name), el('div', 'rk', '#' + fmt(p.rank)),
                 el('div', 'step', String(i + 1)));
      pod.append(col);
    });
    const best = $('rBest'); best.replaceChildren();
    s.bestGuesses.slice(0, 6).forEach(g => {
      const l = el('div', 'line t-' + g.tempKey);
      l.append(el('span', '', g.word), el('span', '', '#' + fmt(g.rank)));
      best.append(l);
    });
    if (!s.bestGuesses.length) best.append(el('div', 'line', '—'));
    streamLeaders($('rStream'), s.streamLeaderboard);
    streamLeaders($('lStream'), s.streamLeaderboard);
    renderPromo(s.promo || []);
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

  // promo lines for the break; one of them is highlighted in turn
  const PROMO_ICONS = ['❤️', '💜', '👥', '🎯', '🔥'];
  const PROMO_COLORS = ['var(--magenta)', 'var(--cyan)', 'var(--lime)', 'var(--gold)', 'var(--orange)'];
  let promoKey = '';
  function renderPromo(lines) {
    const key = lines.join('|');
    if (key === promoKey) return;
    promoKey = key;
    const box = $('promo'); box.replaceChildren();
    lines.forEach((line, i) => {
      const p = el('div', 'p', PROMO_ICONS[i % PROMO_ICONS.length] + ' ' + line.toUpperCase());
      p.style.setProperty('--c', PROMO_COLORS[i % PROMO_COLORS.length]);
      box.append(p);
    });
  }
  let promoI = -1;
  function highlightPromo(step) {
    const items = $('promo').children;
    if (!items.length || step === promoI) return;
    promoI = step;
    [...items].forEach((n, i) => n.classList.toggle('on', i === step % items.length));
  }
  const fmtClock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  let breakVoice = {};

  // TikTok chroma key: green top zone (the camera shows through it), the game below.
  // TT mode (?tt=1, for TikTok LIVE Studio's Link source or the .bat launcher): always like that,
  // a bare 9:16 frame, no controls.
  const QS = new URLSearchParams(location.search);
  const ALPHA = QS.get('alpha') === '1';                  // transparent camera zone instead of green
  const TT = QS.get('tt') === '1' || ALPHA;
  if (TT) document.documentElement.classList.add('tt');
  if (ALPHA) document.documentElement.classList.add('alpha');
  function applyChroma(top, frame) {
    const root = document.documentElement;
    root.classList.toggle('chroma', top > 0);
    // the green zone is top % of the frame's real height (9:16, 9:19.5 or 9:20)
    if (top > 0) root.style.setProperty('--chroma-top', `calc(var(--u) * ${(100 * frame / 9 * top / 100).toFixed(2)})`);
    root.style.setProperty('--fh', (100 * frame / 9).toFixed(2));
    if (ALPHA) root.style.setProperty('--game-bg-top', $('recent').offsetTop + 'px');   // dark from the guesses on
    root.style.setProperty('--fr', (frame / 9).toFixed(4));
    const zone = $('chromaZone'), stage = $('stage');
    if (top > 0) {
      if (zone.parentNode !== stage) stage.prepend(zone);   // the green zone is the top of the frame
      let outer = $('outer');                              // the outer 9:16 frame: game + controls
      if (!outer && !TT) {
        outer = document.createElement('div'); outer.id = 'outer';
        stage.parentNode.insertBefore(outer, stage);
        outer.appendChild(stage);
      }
      const bar = document.querySelector('.ctl-bar');
      if (outer && bar && bar.parentNode !== outer) outer.appendChild(bar);
    } else if ($('outer')) {
      location.reload();                                   // back to the normal layout
    }
  }

  function render(s) {
    S = s;
    applyChroma(TT ? (s.chroma || s.chromaTop || 33) : (s.chroma || 0), s.frame || 16);
    applyTable();                                          // a new row slides in (a setting, maybe following the pace)
    // TT mode: the bottom chatZone % of the frame stays free for TikTok's chat (a setting), the table ends above it
    document.documentElement.style.setProperty('--chat-zone', TT && s.chatZone
      ? `calc(var(--u) * ${(100 * (s.frame || 16) / 9 * s.chatZone / 100).toFixed(2)})` : '0px');
    vocab = s.vocabSize || vocab;
    $('error').hidden = !s.error;
    if (s.error) { $('errText').textContent = t('g.err') + s.error; return; }

    const chip = $('roundChip');
    chip.textContent = t('g.round', { n: s.roundId }) + (s.roundType === 'speed' ? t('g.speed') : '');
    chip.classList.toggle('speed', s.roundType === 'speed');
    $('playersChip').textContent = '👥 ' + s.stats.players;
    fitText($('secretWord'), s.secretWord || '? ? ?');
    $('subs').hidden = !s.subscribersOnly;
    if (s.goal) {
      $('goal').hidden = false;
      $('goalLabel').textContent = s.goal.label;
      $('goalVal').textContent = s.goal.value + '/' + s.goal.target;
      $('goalFill').style.width = Math.min(100, 100 * s.goal.value / s.goal.target) + '%';
    }
    renderHunters(s.topHunters);
    renderChamps(s.champions || []);
    renderGuesses(s.bestGuesses);
    tagline(s);

    // the hint card shows for 3 s after a new hint; the word stays marked 💡 in the guesses
    const h = s.hints[s.hints.length - 1];
    if (h && s.hints.length !== prevHintCount) {
      const ht = hintText(h); $('hintText').textContent = ht.text; $('hintWord').textContent = ht.word;
      $('hintCard').classList.remove('new'); void $('hintCard').offsetWidth; $('hintCard').classList.add('new');
      hintUntil = Date.now() + 3000;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { $('hintCard').hidden = true; }, 3000);
    }
    $('hintCard').hidden = !h || Date.now() >= hintUntil;
    prevHintCount = s.hints.length;

    $('winner').hidden = s.phase !== 'winner';
    $('reveal').hidden = s.phase !== 'reveal';
    if (s.phase === 'winner') renderWinner(s);
    if (s.phase === 'reveal') renderReveal(s);
    if (s.phase === 'playing') tickerFor(s);
    if (s.phase === 'countdown') {               // new round: forget everything from the last one
      prevWords = new Map(); prevHunters = new Map(); fresh = []; queue.length = 0;
      $('miniToasts').replaceChildren();
    }
  }

  // ------------------------------------------------------------ ticker at the CTA line
  // At the start of a round, and again 1 and 2 minutes in: the last round's word, its podium,
  // and the stream's top by wins.
  let tickerRound = null, tickerTimers = [];
  const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function tickerText(s) {
    const parts = [], lr = s.lastRound;
    if (lr && lr.word) {
      parts.push(t('g.tk.word', { w: '<b>' + esc(lr.word.toUpperCase()) + '</b>' })
                 + (lr.reason === 'exact' ? '' : ' ' + t('g.tk.none')));
      (lr.podium || []).slice(0, 3).forEach((n, i) => parts.push(['🥇', '🥈', '🥉'][i] + ' ' + esc(n)));
    }
    const top = (s.streamLeaderboard || []).filter(r => r.wins > 0).slice(0, 5);
    if (top.length) parts.push('🏆 ' + t('g.tk.top') + ' ' +
      top.map(r => esc(r.name) + ' — ' + I18N.n(r.wins, 'win')).join(' · '));
    return parts.join('   ·   ');
  }
  // one message at a time on the ticker line; others wait in a queue
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
    sp.style.setProperty('--dur', ((W + w) / Math.max(120, W / 7)).toFixed(1) + 's');   // ~7 s per screen width
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
    const since = Live.now() - s.startedAt;               // a reload mid-round keeps the schedule
    tickerTimers = [0, 60, 120].filter(at => at - since > -10)
      .map(at => setTimeout(runTicker, Math.max(0, at - since) * 1000));
  }

  // ------------------------------------------------------------ clock: timer, countdown, last 10 s
  let lastBig = null;
  function bigNum(text, cls) {
    if (text === lastBig) return;
    lastBig = text;
    const b = $('bigNum');
    b.className = cls || '';
    b.replaceChildren();
    if (text !== '') b.append(el('span', '', text));
  }
  function clock() {
    if (!S || S.error) return;
    const now = Live.now();
    document.querySelectorAll('.fw').forEach(n => {
      n.textContent = t(n.dataset.short ? 'g.followShort' : 'g.follow', { n: Math.max(0, Math.ceil(Number(n.dataset.until) - now)) });
    });
    const timerEl = $('timer');
    if (S.phase === 'playing') {
      const left = Math.max(0, Math.ceil(S.endsAt - now));
      timerEl.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      timerEl.classList.toggle('low', left <= 10);
      if (left <= 10 && left > 0) {
        if (lastBig !== String(left)) fx('tick', left);
        bigNum(String(left), 'final');
      } else bigNum('');
    } else if (S.phase === 'countdown') {
      const left = Math.ceil(S.phaseUntil - now);
      timerEl.textContent = '0:00'; timerEl.classList.remove('low');
      const label = left > 1 ? String(left - 1) : 'GO!';
      if (lastBig !== label) fx('count', label === 'GO!');
      bigNum(label, label === 'GO!' ? 'go' : 'cd');
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
        if (!v.soon && left <= 30 && left > 25) {
          v.soon = true;
          voice('break', t('g.v.soon'), 'high');
        }
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
  A.mount({ rules: () => ($('rules').hidden ? showRules(12000) : ($('rules').hidden = true)),
            hello: 'g.v.hello', helloRate: 1 });
  showRules(7000);
  // like balloons over the game: each viewer's balloon inflates at the bottom of the game column
  // (above the hint / call to action) and lifts off at 100 likes
  Balloons.mount({ ground: true, area: $('stage'), bottom: 'calc(var(--u) * 26)',
                   width: 'calc(var(--u) * 20)', sound: true });
  Live.start({ game: 'guess', onState: (s, msg) => { tgBot = msg.tgBot || ''; promos = msg.giftPromos || []; render(s); Balloons.render(msg.balloons);
                                                    renderLikers((msg.balloons || {}).likers); }, onEvent,
               onFeed: e => {
                 if (e.type === 'balloon') Balloons.launch(e);
                 else if (e.type === 'plane') Plane.fly(e, { sound: true });
                 else Greeter.push(e);
               } });
})();
