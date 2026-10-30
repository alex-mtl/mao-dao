// LIVE Center page (extension world): passes the recordings list to the background, and scrolls the list
// down when the background looks for an older recording (the page loads it page by page).
window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.__maodao === 'replays') {
        chrome.runtime.sendMessage({ type: 'replays', replays: e.data.replays, more: e.data.more });
    }
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type !== 'scroll') return false;
    const box = [...document.querySelectorAll('div')]
        .filter((d) => d.scrollHeight > d.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(d).overflowY) && d.innerText.includes('Start time'))
        .sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (box) {
        box.scrollTop = box.scrollHeight;
        box.dispatchEvent(new WheelEvent('wheel', { deltaY: 800, bubbles: true }));
    }
    reply({ ok: !!box });
    return false;
});
