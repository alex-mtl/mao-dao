// Background: keeps the recordings list seen in LIVE Center and reads the recordings from TikTok's CDN for the
// mao-dao.com page (which may not read another site itself). Only TikTok CDN addresses are fetched.
const CDN = /^https:\/\/[a-z0-9.-]+\.(tiktokcdn|tiktokcdn-us|tiktokcdn-eu)\.com\//;
const LIVECENTER = 'https://livecenter.tiktok.com/replay';

async function stored() {
    return (await chrome.storage.local.get('replays')).replays || {};
}
let more = true;                    // the list in LIVE Center has older pages
let waiters = [];
async function save(list, hasMore) {
    const all = await stored();
    for (const r of list) all[r.id] = { ...r, seen: Date.now() };
    await chrome.storage.local.set({ replays: all });
    more = hasMore;
    waiters.forEach((w) => w());
    waiters = [];
}
const changed = (ms) => new Promise((r) => { waiters.push(r); setTimeout(r, ms); });

// the recording of a TikTok LIVE (its room id): from what LIVE Center showed; if not there, LIVE Center is
// opened in a background tab and its list scrolled down until the recording (or its start date) shows up
async function replay(roomId, start) {
    let all = await stored();
    if (all[roomId]?.m3u8) return all[roomId];
    const tab = await chrome.tabs.create({ url: LIVECENTER, active: false });
    try {
        const until = Date.now() + 90000;
        await changed(20000);
        while (Date.now() < until) {
            all = await stored();
            if (all[roomId]?.m3u8) return all[roomId];
            const oldest = Math.min(...Object.values(all).map((r) => r.start));
            if (!more || (start && oldest < start - 86400)) break;
            await chrome.tabs.sendMessage(tab.id, { type: 'scroll' }).catch(() => {});
            await changed(4000);
        }
        return (await stored())[roomId] || null;
    } finally {
        chrome.tabs.remove(tab.id).catch(() => {});
    }
}

function base64(buf) {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
}

async function handle(msg, sender) {
    if (msg.type === 'replays') {
        if (sender.url?.startsWith('https://livecenter.tiktok.com/')) await save(msg.replays, msg.more);
        return { ok: true };
    }
    if (msg.type === 'ping') return { ok: true, result: { version: chrome.runtime.getManifest().version } };
    if (msg.type === 'replay') return { ok: true, result: await replay(String(msg.roomId), Number(msg.start) || 0) };
    if (msg.type === 'text' || msg.type === 'range') {
        if (!CDN.test(msg.url)) return { ok: false, error: 'not a TikTok CDN address' };
        const headers = msg.type === 'range' ? { Range: `bytes=${msg.from}-${msg.to}` } : {};
        const res = await fetch(msg.url, { headers });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return msg.type === 'text' ? { ok: true, result: await res.text() } : { ok: true, base64: base64(await res.arrayBuffer()) };
    }
    return { ok: false, error: 'unknown request' };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    handle(msg, sender).then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }));
    return true;
});
