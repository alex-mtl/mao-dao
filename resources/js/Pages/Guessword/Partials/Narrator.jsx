import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useEffect, useRef, useState } from 'react';
import { Switch } from './SettingsPanel';

const SPEECH_LANG = { en: 'en-US', ru: 'ru-RU', fr: 'fr-FR', es: 'es-ES' };
const GAP_MS = 8000;           // greetings are merged and said at most this often
const MAX_QUEUE = 6;           // a busy chat: only the latest messages wait for the voice
const OLD_SEC = 30;            // a message older than this when its turn comes is not read

// what the voice says: no emoji, no [club emotes], no links, no runs of the same sign
const speakable = (text) => String(text || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\p{Extended_Pictographic}‍️]/gu, ' ')
    .replace(/(.)\1{4,}/gu, '$1$1$1')
    .replace(/\s+/g, ' ')
    .trim();
const cleanName = (n) => (n || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim() || '?';

/**
 * The narrator in the streamer's panel: reads every viewer message aloud and greets viewers who join, with the
 * browser's own voice, on the streamer's computer (the overlay's narrator, which speaks inside the game page, is
 * not involved). It listens to the engine's stream feed (websocket of the room's control page), so it works in
 * every mode - in Listen mode it is the only voice there is. Both switches are room settings saved at once
 * (engine global "say_chat" / "say_greet").
 */
export default function Narrator({ s, controlUrl, enabled }) {
    const { t } = useLaravelReactI18n();
    const g = s.draft.global || {};
    const chatOn = !!g.say_chat, greetOn = !!g.say_greet;
    const [active, setActive] = useState(() => (typeof navigator !== 'undefined' && navigator.userActivation ? navigator.userActivation.hasBeenActive : true));
    const [heard, setHeard] = useState(null);                  // the last thing said, for the streamer to see it works

    // the latest settings for the long-lived socket handler
    const cfg = useRef({});
    cfg.current = { chatOn, greetOn, rate: g.voice_rate || 1.5, volume: (g.voice_volume ?? 100) / 100, lang: s.info?.lang || 'en', t };
    const queue = useRef([]);        // {kind: 'chat'|'join', ...}
    const lastGreet = useRef(0);
    const stuckSince = useRef(0);

    useEffect(() => {
        if (active) return undefined;
        const on = () => setActive(true);
        document.addEventListener('pointerdown', on, { once: true, capture: true });
        document.addEventListener('keydown', on, { once: true, capture: true });
        return () => { document.removeEventListener('pointerdown', on, true); document.removeEventListener('keydown', on, true); };
    }, [active]);

    const speak = (text, lang) => {
        const synth = window.speechSynthesis;
        if (!synth || !text) return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        u.rate = cfg.current.rate;
        u.volume = cfg.current.volume;
        synth.speak(u);
        setHeard(text);
    };
    const langOf = (text) => (/[Ѐ-ӿ]/.test(text) ? 'ru-RU' : cfg.current.lang === 'ru' ? 'en-US' : SPEECH_LANG[cfg.current.lang] || 'en-US');

    // one thing at a time: the queue is emptied when the voice is free
    useEffect(() => {
        if (!enabled) return undefined;
        const id = setInterval(() => {
            const synth = window.speechSynthesis;
            const c = cfg.current;
            if (!synth || !(c.chatOn || c.greetOn)) { queue.current = []; return; }
            if (synth.speaking || synth.pending) {                   // Chrome sometimes leaves speech "speaking" forever
                stuckSince.current = stuckSince.current || Date.now();
                if (Date.now() - stuckSince.current > 25000) { synth.cancel(); stuckSince.current = 0; }
                return;
            }
            stuckSince.current = 0;
            if (!active) return;
            const now = Date.now();
            const q = queue.current;
            while (q.length && q[0].kind === 'chat' && now - q[0].at > OLD_SEC * 1000) q.shift();
            // joins wait for a calm moment and go out merged: "Hello Ann, Bob and 3 more"
            const joins = q.filter((e) => e.kind === 'join');
            const chat = q.findIndex((e) => e.kind === 'chat');
            if (chat >= 0) {
                const e = q.splice(chat, 1)[0];
                if (c.chatOn) speak(c.t('guessword.narr_say_chat', { name: e.name, text: e.text }), langOf(e.text));
            } else if (joins.length && now - lastGreet.current >= GAP_MS) {
                queue.current = [];
                lastGreet.current = now;
                const names = joins.map((e) => e.name);
                const who = names.length === 1 ? names[0]
                    : names.length <= 3 ? names.slice(0, -1).join(', ') + c.t('guessword.narr_and') + names[names.length - 1]
                    : c.t('guessword.narr_more', { list: names.slice(0, 2).join(', '), n: names.length - 2 });
                if (c.greetOn) speak(c.t('guessword.narr_say_greet', { who }), SPEECH_LANG[c.lang] || 'en-US');
            }
        }, 400);
        return () => clearInterval(id);
    }, [enabled, active]);

    // the stream feed: comments and joins as they happen (no replay of what was before the socket opened)
    useEffect(() => {
        if (!enabled || !controlUrl) return undefined;
        let ws, retry, feedSeq = null, closed = false;
        const connect = () => {
            const url = new URL(controlUrl + 'ws', window.location.href);
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(url.href);
            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch { return; }
                if (msg.feedSeq === undefined) return;
                if (feedSeq === null || msg.feedSeq < feedSeq) { feedSeq = msg.feedSeq; return; }
                (msg.feed || []).filter((e) => e.seq > feedSeq).forEach((e) => {
                    const c = cfg.current;
                    if (e.type === 'chat' && c.chatOn && !e.host) {
                        const text = speakable(e.text);
                        if (!text) return;
                        queue.current.push({ kind: 'chat', name: cleanName(e.name), text, at: Date.now() });
                    } else if (e.type === 'join' && c.greetOn && e.panel !== false) {
                        queue.current.push({ kind: 'join', name: cleanName(e.name), at: Date.now() });
                    }
                    if (queue.current.length > MAX_QUEUE * 2) queue.current.splice(0, queue.current.length - MAX_QUEUE * 2);
                });
                feedSeq = Math.max(feedSeq, msg.feedSeq);
            };
            ws.onclose = () => { if (!closed) { feedSeq = null; retry = setTimeout(connect, 3000); } };
        };
        connect();
        return () => { closed = true; clearTimeout(retry); try { ws && ws.close(); } catch { /* already closed */ } };
    }, [enabled, controlUrl]);

    // leaving the page silences the voice
    useEffect(() => () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* none */ } }, []);

    const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    const set = (key) => (on) => {
        if (on) {                                                   // a click is the user activation the browser wants
            setActive(true);
            try { window.speechSynthesis.cancel(); } catch { /* none */ }
        }
        s.setNow('global', { [key]: on ? 1 : 0 });
    };
    const test = () => {
        setActive(true);
        try { window.speechSynthesis.cancel(); } catch { /* none */ }
        speak(t('guessword.narr_test_phrase'), SPEECH_LANG[cfg.current.lang] || 'en-US');
    };

    if (!supported) return <p className="mt-3 rounded-xl bg-warm-50 px-3 py-2 text-xs text-ink-600">{t('guessword.narr_unsupported')}</p>;
    return (
        <div className="mt-3 rounded-xl border border-warm-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-heading text-sm font-bold text-ink-900">🗣 {t('guessword.narr_title')}</h3>
                <button type="button" onClick={test} className="text-xs font-semibold text-primary-700 hover:underline">{t('guessword.narr_test')}</button>
            </div>
            <label className="flex items-start justify-between gap-3 py-1.5">
                <span className="min-w-0 text-sm text-ink-800">
                    <span className="font-semibold">{t('guessword.narr_chat')}</span>
                    <span className="block text-xs text-ink-500">{t('guessword.narr_chat_help')}</span>
                </span>
                <Switch on={chatOn} onChange={set('say_chat')} title={t('guessword.narr_chat')} />
            </label>
            <label className="flex items-start justify-between gap-3 py-1.5">
                <span className="min-w-0 text-sm text-ink-800">
                    <span className="font-semibold">{t('guessword.narr_greet')}</span>
                    <span className="block text-xs text-ink-500">{t('guessword.narr_greet_help')}</span>
                </span>
                <Switch on={greetOn} onChange={set('say_greet')} title={t('guessword.narr_greet')} />
            </label>
            {(chatOn || greetOn) && !active && <p className="mt-1 text-xs font-semibold text-warning-700">{t('guessword.narr_click')}</p>}
            {(chatOn || greetOn) && heard && <p className="mt-1 truncate text-xs text-ink-500" title={heard}>🔈 {heard}</p>}
        </div>
    );
}
