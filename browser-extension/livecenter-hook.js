// LIVE Center page (main world): copies the recordings list the page itself loads (/webcast/room/replay/info/)
// to the extension. Its requests are signed for one use, so the extension cannot ask for the list itself.
(() => {
    const pick = (r) => ({
        id: String(r.id), title: r.title || '', start: Number(r.start_time), finish: Number(r.finish_time),
        status: r.status, m3u8: r.m3u8_url || r.play_url || '', duration: r.hls_video_meta_info?.duration || 0,
    });
    const send = (json) => {
        const list = json?.data?.replays;
        if (Array.isArray(list) && list.length) {
            window.postMessage({ __maodao: 'replays', replays: list.map(pick), more: !!json.data.has_more }, location.origin);
        }
    };
    const isList = (u) => String(u).includes('/webcast/room/replay/info/');

    const fetch0 = window.fetch;
    window.fetch = async function (...args) {
        const res = await fetch0.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            if (isList(url)) res.clone().json().then(send, () => {});
        } catch { /* never break the page */ }
        return res;
    };
    const open0 = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (isList(url)) this.addEventListener('load', () => { try { send(JSON.parse(this.responseText)); } catch { /* not JSON */ } });
        return open0.call(this, method, url, ...rest);
    };
})();
