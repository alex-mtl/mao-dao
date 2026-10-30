// mao-dao.com page (extension world): the bridge between the page (resources/js/Pages/Guessword/Digest/livecenter.js)
// and the background. The page posts {__maodao: 'req', id, op, args}, gets {__maodao: 'res', id, ok, result | error};
// bytes come back as an ArrayBuffer.
document.documentElement.dataset.maodaoLivecenter = chrome.runtime.getManifest().version;

window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin || e.data?.__maodao !== 'req') return;
    const { id, op, args } = e.data;
    let res;
    try {
        res = await chrome.runtime.sendMessage({ type: op, ...args });
    } catch (err) {
        res = { ok: false, error: String(err?.message || err) };
    }
    if (res?.ok && res.base64 !== undefined) {
        const s = atob(res.base64), buf = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
        window.postMessage({ __maodao: 'res', id, ok: true, result: buf.buffer }, location.origin, [buf.buffer]);
        return;
    }
    window.postMessage({ __maodao: 'res', id, ok: !!res?.ok, result: res?.result, error: res?.error }, location.origin);
});
