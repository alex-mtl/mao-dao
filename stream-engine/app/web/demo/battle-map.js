// Крепости: hex map generator + base render, shared by battle-mapgen.html (preview) and battle-hex.html (the battle).
// Rules agreed with the owner: docs/games/battle.md, section «Карта».
'use strict';
const W = 540, H = 960, TOP = 104, BOT = 930;
const S = 540 / 50 / Math.sqrt(3), HW = Math.sqrt(3) * S, RS = 1.5 * S; // pointy-top hex, 50 across (~5 000 on the map)
const COLS = Math.ceil(W / HW) + 1, ROWS = Math.ceil(H / RS) + 1, N = COLS * ROWS;
const TEAMS = ['#ff4d5e', '#3d8bff', '#3ddc84', '#ffd23d', '#b46bff', '#3de0e0'];
const hx = i => (i % COLS) * HW + ((i / COLS | 0) & 1 ? HW / 2 : 0), hy = i => (i / COLS | 0) * RS;
const NB_E = [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]], NB_O = [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]];
const nbrs = new Int32Array(N * 6).fill(-1);
for (let i = 0; i < N; i++) { const c = i % COLS, r = i / COLS | 0, tb = r & 1 ? NB_O : NB_E;
  tb.forEach(([dc, dr], k) => { const nc = c + dc, nr = r + dr; if (nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS) nbrs[i * 6 + k] = nr * COLS + nc; }); }
const hexAt = (x, y) => { const r = Math.max(0, Math.min(ROWS - 1, Math.round(y / RS))), c = Math.max(0, Math.min(COLS - 1, Math.round((x - (r & 1 ? HW / 2 : 0)) / HW))); return r * COLS + c; };
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(x, y, s) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y, s) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
const fbm = (x, y, s) => vnoise(x, y, s) * .55 + vnoise(x * 2.1, y * 2.1, s + 7) * .3 + vnoise(x * 4.3, y * 4.3, s + 13) * .15;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
class Heap { constructor() { this.a = []; } get size() { return this.a.length; }
  push(p, v) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i) { const q = i - 1 >> 1; if (a[q][0] <= a[i][0]) break; [a[q], a[i]] = [a[i], a[q]]; i = q; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
    if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; } }
function dijkstra(src, cost, stop) { // cost(i) per hex entered; returns {d, par}
  const d = new Float32Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), h = new Heap();
  for (const s of src) { d[s] = 0; h.push(0, s); }
  while (h.size) { const [du, u] = h.pop(); if (du > d[u]) continue; if (u === stop) break;
    for (let k = 0; k < 6; k++) { const v = nbrs[u * 6 + k]; if (v < 0) continue; const w = cost(v); if (w === Infinity) continue;
      if (du + w < d[v]) { d[v] = du + w; par[v] = u; h.push(d[v], v); } } }
  return { d, par };
}
const cube = i => { const c = i % COLS, r = i / COLS | 0, x = c - (r - (r & 1)) / 2; return [x, r, -x - r]; };
const hdist = (a, b) => { const p = cube(a), q = cube(b); return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])); };
const trace = (par, t) => { const p = []; for (let v = t; v >= 0; v = par[v]) p.push(v); return p; };

// ================= generation =================
// terr: 0 meadow, 1 forest, 2 field, 3 water, 4 hills
function gen(n, seed) {
  const R = mulberry(seed);
  const terr = new Uint8Array(N), elev = new Float32Array(N), own = new Int8Array(N).fill(-1);
  const kind = new Uint8Array(N); // 0 land, 1 wall, 2 town, 3 road, 4 gate, 5 bridge, 6 keep
  const pat = new Int16Array(N);
  const fseeds = Array.from({ length: 140 }, () => ({ x: R() * W, y: R() * H, ang: R() * Math.PI, f: R(), col: R() * 6 | 0 }));
  for (let i = 0; i < N; i++) {
    const x = hx(i), y = hy(i), e = fbm(x / 150, y / 150, seed), m = fbm(x / 110 + 40, y / 110, seed + 3);
    elev[i] = e;
    terr[i] = e > .74 ? 4 : m > .6 ? 1 : 0; // no water at all (owner's call): no lakes, no rivers
  }
  // river: random-weight path between two opposite edges, crossing the neutral middle
  let river = [];
  if (false) { // rivers are off for now (owner's call: they got in the way of the borders)
    const horiz = n === 4 || n === 2 ? R() < .5 || n === 2 : R() < .5;
    const rw = new Float32Array(N); for (let i = 0; i < N; i++) rw[i] = .4 + vnoise(hx(i) / 30, hy(i) / 30, seed + 77) * 3;
    const a = horiz ? hexAt(0, H * (.38 + R() * .24)) : hexAt(W * (.3 + R() * .4), 0), b = horiz ? hexAt(W - 1, H * (.38 + R() * .24)) : hexAt(W * (.3 + R() * .4), H - 1);
    const { par } = dijkstra([a], i => rw[i], b); river = trace(par, b);
    for (const i of river) { terr[i] = 3; for (let k = 0; k < 6; k++) { const v = nbrs[i * 6 + k]; if (v >= 0 && R() < .55) terr[v] = 3; } }
  }
  // territories: the wall is a broken line from one map edge to the other (corner: 20–25 hexes along the top/bottom,
  // 35–40 down the side), 4–6 straight legs with occasional right-angle elbows. Its bulge is searched so the
  // enclosed area hits the target share of the whole map.
  // 2: bands across the top and the bottom (edge to edge); 3: two top corners + a bottom band; 4: corners;
  // 5: corners + the middle of the left edge; 6: corners + the middles of both sides
  const anchors = { 2: ['TB', 'BB'], 3: ['TL', 'TR', 'BB'], 4: ['TL', 'TR', 'BL', 'BR'], 5: ['TL', 'TR', 'BL', 'BR', 'L'], 6: ['TL', 'TR', 'L', 'R', 'BL', 'BR'] }[n];
  const ri = (a, b) => a + R() * (b - a), vb = n >= 5 ? [26, 30] : [35, 40];
  // shares: 4 teams 15–20% each (agreed); otherwise all territories together take 75–80% (20–25% stays free),
  // split roughly evenly with a little variety
  const shares = (() => { if (n === 4) return anchors.map(() => ri(.15, .20));
    const w = anchors.map(() => ri(.9, 1.1)), sw = w.reduce((a, b) => a + b, 0), total = ri(.75, .80); return w.map(x => total * x / sw); })();
  const geom = k => { const a = ri(20, 22) * HW, b = ri(vb[0], vb[1]) * RS, v = ri(13, 16) * RS, bt = () => ri(.28, .4) * H;
    // [O (the line is drawn in polar coordinates round it), P1, P2, the map corners that close the outline after P2]
    return { TL: [[0, 0], [a, 0], [0, b], [[0, 0]]], TR: [[W, 0], [W - a, 0], [W, b], [[W, 0]]], BL: [[0, H], [a, H], [0, H - b], [[0, H]]], BR: [[W, H], [W - a, H], [W, H - b], [[W, H]]],
      TB: [[W / 2, 0], [0, bt()], [W, bt()], [[W, 0], [0, 0]]], BB: [[W / 2, H], [0, H - bt()], [W, H - bt()], [[W, H], [0, H]]],
      L: [[0, H / 2], [0, H / 2 - v], [0, H / 2 + v], [[0, H / 2]]], R: [[W, H / 2], [W, H / 2 - v], [W, H / 2 + v], [[W, H / 2]]] }[k]; };
  const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const segD = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1, u = clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1);
    return Math.hypot(px - ax - dx * u, py - ay - dy * u); };
  const lineD = (x, y, pts) => { let d = Infinity; for (let j = 1; j < pts.length; j++) d = Math.min(d, segD(x, y, pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1])); return d; };
  const GAP = 6.2 * HW, done = []; // at least 5 neutral hexes between the wall hexes of two neighbours
  // zones of influence: every cell goes to the anchor it is "closest" to (distance ÷ √share, warped by noise), and a
  // territory may only use cells ≥ 3 steps inside its own zone — so neighbours keep ≥ 5 free cells between them
  // whatever order they are built in, and a wall pressed against a zone edge still meanders
  const zp = { TL: [0, 0], TR: [W, 0], BL: [0, H], BR: [W, H], L: [0, H / 2], R: [W, H / 2] };
  const zdist = (k, x, y) => k === 'TB' ? y : k === 'BB' ? H - y : Math.hypot(x - zp[k][0], y - zp[k][1]);
  const zone = new Int8Array(N), zw = anchors.map(() => 1), sumS = shares.reduce((a, b) => a + b, 0);
  const wxy = Array.from({ length: N }, (_, i) => { const x = hx(i), y = hy(i);
    return [x + (fbm(x / 120, y / 120, seed + 61) - .5) * 120, y + (fbm(x / 120 + 7, y / 120, seed + 63) - .5) * 120]; });
  for (let it = 0; it < 14; it++) { // balance the weights until every zone is proportional to its team's share
    const area = anchors.map(() => 0);
    for (let i = 0; i < N; i++) { const [wx, wy] = wxy[i]; let b = 0, bd = Infinity;
      anchors.forEach((k, t) => { const d = zdist(k, wx, wy) / zw[t]; if (d < bd) { bd = d; b = t; } }); zone[i] = b; area[b]++; }
    anchors.forEach((_, t) => { zw[t] *= Math.pow(N * shares[t] / sumS / Math.max(1, area[t]), .35); });
  }
  const zb = []; for (let i = 0; i < N; i++) for (let k = 0; k < 6; k++) { const v = nbrs[i * 6 + k]; if (v >= 0 && zone[v] !== zone[i]) { zb.push(i); break; } }
  const zIn = dijkstra(zb, () => 1).d, inZone = (t, i) => zone[i] === t && zIn[i] >= 3;
  const blocked = (x, y) => done.some(D => inPoly(x, y, D.P) || lineD(x, y, D.pts) < GAP);
  const got = [], walls = [];
  [...anchors.keys()].sort(() => R() - .5).forEach(t => { const k = anchors[t];
    const blockedT = (x, y) => !inZone(t, hexAt(x, y)) || blocked(x, y);
    const [O, P1, P2, close] = geom(k), r1 = Math.hypot(P1[0] - O[0], P1[1] - O[1]), r2 = Math.hypot(P2[0] - O[0], P2[1] - O[1]);
    let a1 = Math.atan2(P1[1] - O[1], P1[0] - O[0]), a2 = Math.atan2(P2[1] - O[1], P2[0] - O[0]);
    const into = a => { const x = O[0] + Math.cos(a) * 30, y = O[1] + Math.sin(a) * 30; return x > 0 && x < W && y > 0 && y < H; };
    if (a2 - a1 > Math.PI) a2 -= Math.PI * 2; else if (a1 - a2 > Math.PI) a2 += Math.PI * 2;
    if (!into((a1 + a2) / 2)) a2 += a2 > a1 ? -Math.PI * 2 : Math.PI * 2;
    // a meandering line: radius and angle both wander with two octaves of noise (no straight legs)
    const ns = seed + 100 + t * 17, f1 = 2.5 + R() * 1.5, f2 = 7 + R() * 4;
    const line = bulge => {
      const pts = [];
      for (let j = 0; j <= 80; j++) {
        const tt = j / 80, env = Math.sin(Math.PI * tt);
        const wob = (vnoise(tt * f1, 1, ns) - .5) * .7 + (vnoise(tt * f2, 2, ns) - .5) * .3;
        const a = a1 + (a2 - a1) * (tt + (vnoise(tt * f1, 3, ns) - .5) * .18 * env);
        let r = (r1 + (r2 - r1) * tt) * (1 + bulge * env) * (1 + wob * env), p;
        if (j === 0 || j === 80) { // the ends stay on the map edge; slide them towards our corner if a neighbour is there
          const E = j ? P2 : P1; let s = 1;
          do { p = [O[0] + (E[0] - O[0]) * s, O[1] + (E[1] - O[1]) * s]; s *= .95; } while (s > .3 && blockedT(p[0], p[1]));
        } else for (;;) { // pull the point back towards our corner until it is clear of every neighbour
          // only the two ends touch the map edge: the rest of the line keeps 3 hexes off it (else the wall splits in two)
          p = [clamp(O[0] + Math.cos(a) * r, 3 * HW, W - 3 * HW), clamp(O[1] + Math.sin(a) * r, 3 * RS, H - 3 * RS)];
          if (r < 25 || !blockedT(p[0], p[1])) break; r *= .95;
        }
        pts.push(p);
      }
      return pts;
    };
    // exact rule on hexes: no hex closer than 6 steps to an existing territory (→ ≥ 5 free hexes between walls)
    const free = new Uint8Array(N);
    { const src = []; for (let i = 0; i < N; i++) if (own[i] >= 0) src.push(i);
      const dd = src.length ? dijkstra(src, () => 1).d : null; for (let i = 0; i < N; i++) free[i] = own[i] < 0 && inZone(t, i) && (!dd || dd[i] >= 6) ? 1 : 0; }
    const start = hexAt(O[0] + (W / 2 - O[0]) * .04, O[1] + (H / 2 - O[1]) * .04);
    const claim = pts => { // the polygon ∩ free hexes, only the piece connected to our corner, holes filled
      const P = [...pts, ...close], inS = new Uint8Array(N); for (let i = 0; i < N; i++) if (free[i] && inPoly(hx(i), hy(i), P)) inS[i] = 1;
      inS[start] = 1; const keep = new Uint8Array(N), st = [start]; keep[start] = 1;
      while (st.length) { const u = st.pop(); for (let k = 0; k < 6; k++) { const v = nbrs[u * 6 + k]; if (v >= 0 && inS[v] && !keep[v]) { keep[v] = 1; st.push(v); } } }
      const outside = new Uint8Array(N), q = []; // everything reachable from the screen edge without crossing us
      for (let i = 0; i < N; i++) { const c = i % COLS, r = i / COLS | 0; if (!keep[i] && (c === 0 || r === 0 || hx(i) >= W - HW || hy(i) >= H - RS)) { outside[i] = 1; q.push(i); } }
      while (q.length) { const u = q.pop(); for (let k = 0; k < 6; k++) { const v = nbrs[u * 6 + k]; if (v >= 0 && !keep[v] && !outside[v]) { outside[v] = 1; q.push(v); } } }
      for (let i = 0; i < N; i++) if (!outside[i] && !keep[i] && free[i]) keep[i] = 1;
      return keep;
    };
    const count = s => { let c = 0; for (let i = 0; i < N; i++) c += s[i]; return c; };
    const want = N * shares[t] * (n <= 2 || n === 4 ? 1 : 1.15); // aim a bit high: the zone margins eat into the area
    let lo = -.4, hi = 2.6; for (let it = 0; it < 12; it++) { const mid = (lo + hi) / 2; if (count(claim(line(mid))) < want) lo = mid; else hi = mid; }
    const pts = line((lo + hi) / 2), keep = claim(pts);
    let c = 0; for (let i = 0; i < N; i++) if (keep[i]) { own[i] = t; c++; }
    got[t] = c; walls[t] = pts; done.push({ P: [...pts, ...close], pts });
  });
  const land = N;
  // depth inside each territory (distance to its border) → keep at the deepest hex, town around it
  const depth = new Float32Array(N).fill(Infinity), border = [];
  for (let i = 0; i < N; i++) { if (own[i] < 0) continue;
    for (let k = 0; k < 6; k++) { const v = nbrs[i * 6 + k]; if (v >= 0 && own[v] !== own[i]) { border.push(i); break; } } }
  { const { d } = dijkstra(border, i => own[i] >= 0 ? 1 : Infinity); for (let i = 0; i < N; i++) if (own[i] >= 0) depth[i] = d[i]; }
  const towns = anchors.map((_, t) => ({ t, keep: -1, hexes: [], gates: [], towers: [], corners: [], cgate: -1 }));
  for (let i = 0; i < N; i++) { const t = own[i]; if (t < 0) continue; const T = towns[t];
    if (T.keep < 0 || depth[i] + hash(i, t, 3) * .5 > depth[T.keep]) T.keep = i; }
  // the castle: one big hex with a side of 5 cells (radius 4 → 61 cells) round the deepest point of the territory:
  // ring = castle wall (6 corner towers, one gate facing the map centre), inside a courtyard, the 7 central cells = donjon
  for (const T of towns) {
    // centre: the cell farthest from both our border and the visible screen edge (the HUD bands count as edge)
    const src = []; for (let i = 0; i < N; i++) if (own[i] !== T.t || hy(i) < TOP || hy(i) > BOT || hx(i) < HW / 2 || hx(i) > W - HW / 2) src.push(i);
    const room = dijkstra(src, () => 1).d; T.keep = -1;
    for (let i = 0; i < N; i++) if (own[i] === T.t && (T.keep < 0 || room[i] + hash(i, T.t, 3) * .5 > room[T.keep])) T.keep = i;
    T.room = room[T.keep];
    const ctr = hexAt(W / 2, H / 2); let gBest = -1, gd = Infinity;
    for (let i = 0; i < N; i++) {
      const d = hdist(i, T.keep); if (d > 4 || own[i] !== T.t) continue;
      T.hexes.push(i); kind[i] = d === 4 ? 8 : d <= 1 ? 6 : 9;
      if (d === 4) { const p = cube(i), q = cube(T.keep), ax = [Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])];
        if (ax.filter(v => v === 4).length === 2) T.corners.push(i);
        else { const dc = hdist(i, ctr); if (dc < gd) { gd = dc; gBest = i; } } }
    }
    T.cgate = gBest; if (gBest >= 0) kind[gBest] = 9;
  }
  // walls: every territory hex that touches another owner (not water); the map edge needs no wall
  // the wall is unbroken: every border hex, whatever the ground (water included); off-screen hexes are the map edge
  for (const i of border) for (let k = 0; k < 6; k++) { const v = nbrs[i * 6 + k];
    if (v >= 0 && own[v] !== own[i] && hx(v) < W - 2 && hy(v) < H - 2) { kind[i] = 1; break; } }
  // fields: voronoi patches, farmland mostly inside territories and around holdings
  for (let i = 0; i < N; i++) {
    const x = hx(i), y = hy(i); let b = 0, bd = Infinity;
    for (let k = 0; k < fseeds.length; k++) { const s = fseeds[k], d = (x - s.x) ** 2 + (y - s.y) ** 2; if (d < bd) { bd = d; b = k; } }
    pat[i] = b;
    if (terr[i] === 0 || terr[i] === 1) { const f = fseeds[b].f; if ((own[i] >= 0 && depth[i] > 3 && f < .62) || (own[i] < 0 && f < .22)) terr[i] = 2; }
  }
  // roads: keep → crossroads, keep → neighbouring keeps, crossroads → off the map; gates where they cross walls
  // the crossroads abbey sits on neutral land, ≥ 3 hexes from any territory, nearest the centre
  const ownD = dijkstra([...Array(N).keys()].filter(i => own[i] >= 0), () => 1).d;
  const hc = [W / 2 + (R() - .5) * 40, (TOP + BOT) / 2 + (R() - .5) * 60];
  let hub = -1; for (let i = 0, bd = Infinity; i < N; i++) { if (ownD[i] < 3 || terr[i] === 3) continue; const d = Math.hypot(hx(i) - hc[0], hy(i) - hc[1]); if (d < bd) { bd = d; hub = i; } }
  const roads = []; // no roads for now (owner's call)
  // gates: two per wall, each 4 wall hexes in a row along the wall, ≥ 5 hexes from every map edge, ≥ 20 hexes from the other gate
  const visC = Math.floor((W - HW / 2) / HW), visR = Math.floor((H - 1) / RS); // last on-screen column / row
  const offEdge = i => { const c = i % COLS, r = i / COLS | 0; return c >= 5 && r >= 5 && c <= visC - 5 && r <= visR - 5; };
  for (const T of towns) {
    const wall = []; for (let i = 0; i < N; i++) if (own[i] === T.t && kind[i] === 1 && offEdge(i)) wall.push(i);
    const ok = v => v >= 0 && own[v] === T.t && kind[v] === 1 && offEdge(v);
    const pair = i => { // walk along the wall from i (both directions) until the gate is 4 hexes wide
      const path = [i];
      for (let guard = 0; path.length < 4 && guard < 8; guard++) {
        for (const end of [path.length - 1, 0]) {
          const u = path[end], m = [];
          for (let k = 0; k < 6; k++) { const v = nbrs[u * 6 + k]; if (ok(v) && !path.includes(v)) m.push(v); }
          if (m.length && path.length < 4) { const v = m[R() * m.length | 0]; end ? path.push(v) : path.unshift(v); }
        }
      }
      return path.length === 4 ? path : null;
    };
    // two gates 20 apart; a short wall (5–6 teams) may take 15; failing that, a single gate
    for (const apart of [20, 15]) for (let tries = 0; tries < 60 && T.gates.length < 2; tries++) {
      T.gates = [];
      const a = pair(wall[R() * wall.length | 0]); if (!a) continue;
      const far = wall.filter(i => a.every(g => hdist(i, g) >= apart)); if (!far.length) continue;
      const b = pair(far[R() * far.length | 0]); if (!b || !a.every(g => b.every(h => hdist(g, h) >= apart))) continue;
      T.gates = [a, b];
    }
    for (let tries = 0; tries < 30 && !T.gates.length; tries++) { const a = pair(wall[R() * wall.length | 0]); if (a) T.gates = [a]; }
    for (const gt of T.gates) for (const i of gt) kind[i] = 4;
  }
  // archer towers on the wall cells that flank each gate
  for (const T of towns) for (const gt of T.gates) for (const i of gt) for (let k = 0; k < 6; k++) {
    const v = nbrs[i * 6 + k]; if (v >= 0 && own[v] === T.t && kind[v] === 1 && !T.towers.includes(v)) { kind[v] = 7; T.towers.push(v); } }
  // neutral holdings: farthest-point sampling over the neutral land
  const objs = [], cand = []; for (let i = 0; i < N; i += 7) if (own[i] < 0 && terr[i] !== 3 && hy(i) > TOP + 30 && hy(i) < BOT - 30 && hx(i) > 20 && hx(i) < W - 20) cand.push(i);
  for (let k = 0; k < 5 + n && cand.length; k++) {
    let best = -1, bs = -1;
    for (const i of cand) { if (ownD[i] < 3) continue; let d = Math.hypot(hx(i) - hx(hub), hy(i) - hy(hub)); for (const o of objs) d = Math.min(d, Math.hypot(hx(i) - o.x, hy(i) - o.y));
      d = Math.min(d, ownD[i] * HW * 1.3) + R() * 20; if (d > bs) { bs = d; best = i; } }
    if (best < 0) break;
    const near = j => { for (const r of river) if (Math.hypot(hx(r) - hx(best), hy(r) - hy(best)) < 45) return true; return false; };
    const type = near() ? 'mill' : terr[best] === 4 ? 'quarry' : terr[best] === 2 ? 'farm' : ['farm', 'watch', 'quarry', 'watch'][k % 4];
    objs.push({ i: best, x: hx(best), y: hy(best), type, water: type === 'mill' && near() });
  }
  const trees = []; const occ = new Set();
  for (let i = 0; i < N; i++) { if (terr[i] !== 1 || kind[i] !== 0 || hash(i, 1, seed) > .6) continue; const k = (hx(i) / 7 | 0) + ',' + (hy(i) / 7 | 0); if (occ.has(k)) continue; occ.add(k);
    trees.push({ x: hx(i), y: hy(i), r: 3.5 + hash(i, 2, seed) * 3, h: 95 + hash(i, 3, seed) * 30 | 0, l: 21 + hash(i, 4, seed) * 9 | 0 }); }
  trees.sort((a, b) => a.y - b.y);
  // self-check: wall pieces per team (must be 1) and the fewest hexes between two teams' walls (must be ≥ 5)
  const isWall = (i, t) => own[i] === t && (kind[i] === 1 || kind[i] === 4 || kind[i] === 7);
  const pieces = anchors.map((_, t) => { const seen = new Uint8Array(N); let c = 0;
    for (let i = 0; i < N; i++) { if (!isWall(i, t) || seen[i]) continue; c++; const st = [i]; seen[i] = 1;
      while (st.length) { const u = st.pop(); for (let k = 0; k < 6; k++) { const v = nbrs[u * 6 + k]; if (v >= 0 && !seen[v] && isWall(v, t)) { seen[v] = 1; st.push(v); } } } }
    return c; });
  let minGap = Infinity;
  anchors.forEach((_, t) => { const src = []; for (let i = 0; i < N; i++) if (isWall(i, t)) src.push(i);
    const { d } = dijkstra(src, () => 1); for (let i = 0; i < N; i++) if ((kind[i] === 1 || kind[i] === 4 || kind[i] === 7) && own[i] !== t) minGap = Math.min(minGap, d[i] - 1); });
  const gateGap = Math.min(...towns.map(T => T.gates.length === 2 ? Math.min(...T.gates[0].flatMap(g => T.gates[1].map(h => hdist(g, h)))) : 0));
  return { n, seed, terr, elev, own, kind, pat, fseeds, towns, roads, hub, objs, trees, got, land, walls, pieces, minGap, gateGap, shares };
}

// ================= render =================
function hexPath(g, x, y, s) { g.moveTo(x, y - s); g.lineTo(x + .866 * s, y - s / 2); g.lineTo(x + .866 * s, y + s / 2); g.lineTo(x, y + s); g.lineTo(x - .866 * s, y + s / 2); g.lineTo(x - .866 * s, y - s / 2); g.closePath(); }
function mix(c, t, a) { return [c[0] + (t[0] - c[0]) * a, c[1] + (t[1] - c[1]) * a, c[2] + (t[2] - c[2]) * a]; }
const rgb = h => { const v = parseInt(h.slice(1), 16); return [v >> 16, v >> 8 & 255, v & 255]; };
const CROPS = [[205, 179, 90], [169, 185, 85], [201, 154, 74], [141, 108, 70], [185, 196, 106], [214, 191, 110]];
const ROOFS = [[181, 82, 59], [160, 71, 47], [192, 102, 63], [143, 90, 58], [155, 61, 46], [184, 106, 60]];
// live = the battle's static base: walls, towers and castle rings are left out (the battle draws them every frame,
// damaged or in ruins); the ground under them is painted instead
function render(M, cv, live = false) {
  const g = cv.getContext('2d'), { terr, elev, own, pat, fseeds, seed } = M, teamRGB = TEAMS.map(rgb);
  const kind = live ? M.kind.map(k => (k === 1 || k === 7 || k === 8 ? 0 : k)) : M.kind;
  g.fillStyle = '#151a0e'; g.fillRect(0, 0, W, H);
  // group hexes by colour so each colour is one fill (fast); colours are quantised a little
  const buckets = new Map();
  for (let i = 0; i < N; i++) {
    const x = hx(i), y = hy(i), t = terr[i], k = kind[i], e = elev[i], det = hash(i, 0, seed);
    const e1 = elev[Math.max(0, i - COLS * 2 - 2)], e2 = elev[Math.min(N - 1, i + COLS * 2 + 2)];
    let hs = clamp(1 + (e1 - e2) * 8, .75, 1.28), c;
    if (k === 6) { c = mix(teamRGB[own[i]], [0, 0, 0], .15 + det * .15); hs = 1; }           // donjon roof
    else if (k === 1 || k === 7) { c = teamRGB[own[i]]; hs = 1; }                              // territory wall: team colour
    else if (k === 8) { c = mix([176, 170, 158], [140, 134, 124], det * .6); hs = 1; }           // castle wall: stone
    else if (k === 9) { c = mix([196, 184, 152], [176, 162, 128], det * .6); hs = 1; }           // castle courtyard
    else if (k === 5) c = [123, 82, 48];
    else if (k === 3) c = mix([211, 192, 139], [180, 160, 110], det * .5);
    else if (k === 2) { const v = vnoise(x / 7, y / 7, seed + 9); c = v > .38 ? ROOFS[(vnoise(x / 9, y / 9, seed + 5) * 6) | 0] : [196, 182, 150]; if (v > .38) c = mix(c, [255, 255, 255], det * .12); hs = 1; }
    else if (t === 3) c = mix([46, 104, 152], [70, 130, 180], vnoise(x / 12, y / 12, seed + 4) * .6);
    else if (t === 2) { const s = fseeds[pat[i]], st = Math.sin((x * Math.cos(s.ang) + y * Math.sin(s.ang)) / 3); c = CROPS[s.col].map(v => v * (.9 + st * .08 + det * .06)); }
    else if (t === 1) c = mix([40, 66, 30], [62, 94, 42], det * .7 + vnoise(x / 10, y / 10, seed + 2) * .3);
    else if (t === 4) c = mix([128, 124, 98], [150, 144, 112], det);
    else { const f = fbm(x / 45, y / 45, seed + 51); c = [84 + f * 30 + det * 10, 116 + f * 28 + det * 10, 48 + f * 14 + det * 4]; }
    if (own[i] >= 0 && ![1, 6, 7, 8, 9].includes(k)) c = mix(c, teamRGB[own[i]], .13); // gates (4) show the ground, tinted
    const q = c.map(v => clamp(Math.round(v * hs / 6) * 6, 0, 255)), key = `rgb(${q[0]},${q[1]},${q[2]})`;
    let b = buckets.get(key); if (!b) { b = []; buckets.set(key, b); } b.push(i);
  }
  for (const [col, list] of buckets) { g.fillStyle = col; g.beginPath(); for (const i of list) hexPath(g, hx(i), hy(i), S * .93); g.fill(); }
  // walls (territory: team colour, castle: stone) lifted on a shadow
  const raised = k => k === 1 || k === 7 || k === 8;
  g.fillStyle = '#0005'; g.beginPath(); for (let i = 0; i < N; i++) if (raised(kind[i])) hexPath(g, hx(i) + 1.6, hy(i) + 2.2, S * .92); g.fill();
  for (let i = 0; i < N; i++) if (raised(kind[i])) {
    g.fillStyle = kind[i] === 8 ? `rgb(${mix([176, 170, 158], [140, 134, 124], hash(i, 0, seed) * .6).map(Math.round)})` : TEAMS[own[i]];
    g.beginPath(); hexPath(g, hx(i), hy(i), S * .95); g.fill(); }
  for (const tr of M.trees) {
    g.fillStyle = '#0006'; g.beginPath(); g.ellipse(tr.x + 1.5, tr.y + 2, tr.r, tr.r * .8, 0, 0, 7); g.fill();
    g.fillStyle = `hsl(${tr.h},40%,${tr.l}%)`; g.beginPath(); g.arc(tr.x, tr.y, tr.r, 0, 7); g.fill();
    g.fillStyle = `hsla(${tr.h - 10},45%,${tr.l + 14}%,.55)`; g.beginPath(); g.arc(tr.x - tr.r * .3, tr.y - tr.r * .3, tr.r * .5, 0, 7); g.fill();
  }
  if (live) { for (const o of M.objs) drawObj(g, o); drawAbbey(g, M); return; }
  for (const T of M.towns) {
    const col = TEAMS[T.t];
    const tower = (x, y, r) => {
      g.fillStyle = '#0006'; g.beginPath(); g.arc(x + 2, y + 2.5, r + .5, 0, 7); g.fill();
      g.fillStyle = '#a19b90'; g.strokeStyle = '#3b3631'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
      g.strokeStyle = '#d6d0c2'; g.lineWidth = 1.2; g.setLineDash([2, 2]); g.beginPath(); g.arc(x, y, r - 1.6, 0, 7); g.stroke(); g.setLineDash([]);
      g.fillStyle = col; g.beginPath(); g.arc(x, y, r * .45, 0, 7); g.fill();
    };
    for (const i of T.towers) { const x = hx(i), y = hy(i); tower(x, y, S * 1.05); // archer tower: a bow on top
      g.strokeStyle = '#3a2614'; g.lineWidth = 1.4; g.beginPath(); g.arc(x - 1, y, 3.2, -1.1, 1.1); g.stroke();
      g.strokeStyle = '#efe6cf'; g.lineWidth = .8; g.beginPath(); g.moveTo(x - 1 + Math.cos(-1.1) * 3.2, y + Math.sin(-1.1) * 3.2); g.lineTo(x - 1 + Math.cos(1.1) * 3.2, y + Math.sin(1.1) * 3.2); g.stroke(); }
    for (const i of T.corners) tower(hx(i), hy(i), S * 1.3);
    if (T.cgate >= 0) { const gx = hx(T.cgate), gy = hy(T.cgate), a = Math.atan2(gy - hy(T.keep), gx - hx(T.keep)); // castle gate: open oak doors
      g.save(); g.translate(gx, gy); g.rotate(a); g.fillStyle = '#6b4423'; g.fillRect(-1, -S * .9, 4, 3.5); g.fillRect(-1, S * .9 - 3.5, 4, 3.5); g.restore(); }
    const x = hx(T.keep), y = hy(T.keep);
    g.strokeStyle = '#0006'; g.lineWidth = 2; g.beginPath(); hexPath(g, x, y, S * 2.6); g.stroke();
    g.strokeStyle = '#2b2622'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 26); g.stroke();
    g.fillStyle = col; g.beginPath(); g.moveTo(x, y - 26); g.quadraticCurveTo(x + 10, y - 24, x + 18, y - 20); g.lineTo(x, y - 15); g.fill();
    g.fillStyle = '#fff'; g.font = '900 10px system-ui'; g.textAlign = 'center'; g.fillText(T.t + 1, x + 7, y - 18);
  }
  drawAbbey(g, M);
  for (const o of M.objs) drawObj(g, o);
  // a few soldiers to show the scale: a head is one hex
  for (const T of M.towns) for (let k = 0; k < 6; k++) { const a = k * 1.05 + T.t, x = hx(T.keep) + Math.cos(a) * 64, y = hy(T.keep) + Math.sin(a) * 64;
    g.fillStyle = '#0006'; g.beginPath(); g.ellipse(x + 2, y + 3, 4, 2.6, 0, 0, 7); g.fill();
    g.fillStyle = TEAMS[T.t]; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.strokeStyle = '#0009'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#9a9a9a'; g.beginPath(); g.arc(x, y - 1, 2, 0, 7); g.fill(); }
  const vg = g.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 660); vg.addColorStop(0, '#0000'); vg.addColorStop(1, '#0007'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  g.fillStyle = '#000a'; g.fillRect(0, 0, W, TOP - 10); g.fillRect(0, BOT + 6, W, H - BOT);
  g.fillStyle = '#f4e6c2'; g.font = '900 22px Georgia, serif'; g.textAlign = 'center'; g.fillText(`⚔ КРЕПОСТИ · ${M.n} команды`, W / 2, 34);
  g.font = '600 12px system-ui'; g.fillStyle = '#bbb';
  g.fillText(M.got.map((c, t) => `${t + 1}: ${Math.round(c / M.land * 100)}%`).join('   ') + `   нейтр.: ${Math.round((1 - M.got.reduce((a, b) => a + b, 0) / M.land) * 100)}%`, W / 2, 62);
  g.fillStyle = '#888'; g.fillText(`${N.toLocaleString('ru')} гексов · карта №${M.seed % 10000}`, W / 2, 82);
}
// a map that breaks a rule (wall in pieces, < 5 hexes between walls, gates < 20 apart, a territory under its share,
// a castle that does not fit) is rerolled
// (2 gates are preferred: the first tries insist on them, the last ones accept a single gate)
function mapOk(M, strict) {
  const free = 1 - M.got.reduce((a, b) => a + b, 0) / N;
  return M.pieces.every(p => p === 1) && M.minGap >= 5 && M.towns.every(T => T.hexes.length === 61 && T.room >= 6)
    && M.got.every((c, t) => c / N >= (M.n === 4 ? .149 : M.shares[t] * .8))
    // free land: 20–25% is the aim, but the ≥ 5-cell gaps between every pair of neighbours eat more with many teams
    // (measured: 3 teams 25–31%, 5–6 teams ~32%)
    && (M.n === 4 || (free >= .19 && free <= ({ 2: .26, 3: .30 }[M.n] || .35)))
    && M.towns.every(T => T.gates.length === 2 || (!strict && T.gates.length === 1))
    && (M.gateGap >= (M.n >= 5 ? 15 : 20) || (!strict && M.gateGap === 0));
}
function genValid(n) {
  let M, tries = 0;
  do { M = gen(n, (Math.random() * 1e9) | 0); tries++; } while (tries < 10 && !mapOk(M, tries <= 6));
  return M;
}
function drawAbbey(g, M) {
  const x = hx(M.hub), y = hy(M.hub); g.fillStyle = '#0005'; g.fillRect(x - 10, y - 8, 24, 24); g.fillStyle = '#9a7b62'; g.fillRect(x - 12, y - 12, 24, 24);
  g.fillStyle = '#5f8a3c'; g.fillRect(x - 5, y - 5, 10, 10); g.fillStyle = '#e8e0cc'; g.fillRect(x - 1, y - 4, 2, 8); g.fillRect(x - 3, y - 2, 6, 2);
}
function drawObj(g, o) {
  g.save(); g.translate(o.x, o.y);
  g.strokeStyle = '#ffffffaa'; g.lineWidth = 1.5; g.setLineDash([3, 4]); g.beginPath(); g.arc(0, 0, 26, 0, 7); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#0005'; g.beginPath(); g.ellipse(3, 5, 14, 8, 0, 0, 7); g.fill();
  if (o.type === 'farm') {
    g.fillStyle = '#7a3a2a'; g.fillRect(-9, -8, 18, 13); g.fillStyle = '#a24c34'; g.fillRect(-9, -8, 18, 6); g.fillStyle = '#d9c27a'; g.beginPath(); g.arc(11, 7, 4, 0, 7); g.fill();
  } else if (o.type === 'mill') {
    if (o.water) { g.fillStyle = '#6b4a2b'; g.beginPath(); g.arc(-10, 6, 6, 0, 7); g.fill(); }
    g.fillStyle = '#d9cdb0'; g.strokeStyle = '#5a4a36'; g.lineWidth = 1.5; g.beginPath(); g.arc(2, -2, 7, 0, 7); g.fill(); g.stroke();
    g.strokeStyle = '#efe6cf'; g.lineWidth = 3; for (let a = 0; a < 4; a++) { const t = a * Math.PI / 2 + .4; g.beginPath(); g.moveTo(2, -2); g.lineTo(2 + Math.cos(t) * 15, -2 + Math.sin(t) * 15); g.stroke(); }
  } else if (o.type === 'quarry') {
    g.fillStyle = '#7d776d'; g.beginPath(); g.moveTo(-14, 0); g.lineTo(-7, -11); g.lineTo(9, -9); g.lineTo(14, 4); g.lineTo(3, 11); g.lineTo(-11, 9); g.closePath(); g.fill();
    g.fillStyle = '#5a554d'; g.beginPath(); g.ellipse(0, 0, 8, 5, .3, 0, 7); g.fill();
  } else {
    g.fillStyle = '#5a3a1e'; g.fillRect(-7, -7, 14, 14); g.fillStyle = '#8a5a30'; g.fillRect(-5, -5, 10, 10);
  }
  g.strokeStyle = '#2b2622'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(12, -6); g.lineTo(12, -22); g.stroke();
  g.fillStyle = '#e9e4d8'; g.beginPath(); g.moveTo(12, -22); g.lineTo(23, -18); g.lineTo(12, -14); g.fill();
  g.restore();
}
