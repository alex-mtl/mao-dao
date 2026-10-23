import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The room's settings, read from and written to the stream engine directly (same origin,
 * /guessword/engine/r/<control token>/api/...). Keeps what the engine has (saved) and what the
 * streamer is changing (draft); apply() sends only the changed values, section by section
 * ("guess", "streamer", "global").
 */
export default function useEngineSettings(controlUrl, enabled) {
    const [info, setInfo] = useState(null);         // engine's /api/games: active game, choices, values
    const [saved, setSaved] = useState({});
    const [draft, setDraft] = useState({});
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);

    const call = useCallback(
        (path, body) =>
            fetch(controlUrl + 'api/' + path, body
                ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
                : {}).then((r) => {
                if (!r.ok) throw new Error(r.status);
                return r.json();
            }),
        [controlUrl],
    );

    const load = useCallback(() => {
        if (!enabled) return;
        call('games')
            .then((d) => {
                // sections: each game's options, global (likes...), toasts {id: {show, voice, rate}}, gifts {action: rule}
                const values = { global: { ...d.global.values }, toasts: { ...(d.toasts?.values || {}) }, gifts: { ...(d.gifts?.values || {}) } };
                d.games.forEach((g) => { values[g.name] = { ...g.values }; });
                setInfo(d);
                setSaved(values);
                setDraft(values);
                setFailed(false);
            })
            .catch(() => setFailed(true));
    }, [call, enabled]);

    useEffect(load, [load]);

    const set = (section, key, value) =>
        setDraft((d) => ({ ...d, [section]: { ...d[section], [key]: value } }));

    const diff = useMemo(() => {
        const out = {};
        Object.entries(draft).forEach(([section, values]) => {
            Object.entries(values || {}).forEach(([k, v]) => {
                if (JSON.stringify(saved[section]?.[k]) !== JSON.stringify(v)) (out[section] ||= {})[k] = v;
            });
        });
        return out;
    }, [draft, saved]);
    const changes = Object.values(diff).reduce((n, o) => n + Object.keys(o).length, 0);

    const apply = async () => {
        if (!changes) return true;
        setBusy(true);
        try {
            for (const [game, options] of Object.entries(diff)) {
                await call('settings', { game, options });
            }
            setSaved(draft);
            return true;
        } catch (e) {
            return false;
        } finally {
            setBusy(false);
        }
    };

    const setActive = (game) => call('active', { game }).then((d) => setInfo((i) => (i ? { ...i, active: d.active } : i)));

    return {
        info, draft, set, changes, busy, failed, apply, setActive, call,
        reset: () => setDraft(saved),
        choices: (section, key) =>
            section === 'global'
                ? info?.global?.options?.[key] || []
                : info?.games?.find((g) => g.name === section)?.options?.[key] || [],
    };
}
