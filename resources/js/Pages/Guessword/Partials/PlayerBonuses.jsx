import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ViewerPicker, { Avatar } from './ViewerPicker';

export const BONUS_ICONS = { hint: '💡', cake: '🎂', boost: '⚡', multi: '✍️', balloon: '🎈', plane: '✈️', bomber: '🦋', snowball: '❄️' };

const xsrf = () => decodeURIComponent((document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/) || [])[1] || '');
const btn = 'h-8 min-w-8 rounded-lg border border-warm-300 bg-surface px-2 text-sm font-semibold text-ink-800 hover:bg-warm-50 disabled:opacity-40';
const when = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * The monitor's "Players' bonuses" tab: who has what on account in this room (Laravel keeps it, the engine
 * spends it in the chat) - players on the left, the picked one's bonuses with +/- and "give" on the right.
 * url: the room's bonuses address (GET the list, POST {viewer, kind, delta, name}); call: the engine's API
 * (the stream's viewers, for their nicknames and avatars); boosts: who has the boost active this stream.
 */
export default function PlayerBonuses({ url, call, boosts }) {
    const { t } = useLaravelReactI18n();
    const [data, setData] = useState(null);
    const [viewers, setViewers] = useState([]);
    const [sel, setSel] = useState(null);               // {viewer, name}
    const [q, setQ] = useState('');
    const [login, setLogin] = useState('');
    const [give, setGive] = useState({ kind: 'cake', n: 1 });
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);

    const load = useCallback(() => {
        const u = url + (sel ? '?viewer=' + encodeURIComponent(sel.viewer) : '');
        return fetch(u, { headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setData).catch(() => {});
    }, [url, sel]);
    useEffect(() => {
        load();
        const a = setInterval(load, 5000);
        return () => clearInterval(a);
    }, [load]);
    useEffect(() => { call('viewers').then((d) => setViewers(d.viewers || [])).catch(() => {}); }, [call]);

    const seen = useMemo(() => Object.fromEntries(viewers.map((v) => [v.id.toLowerCase(), v])), [viewers]);
    const players = useMemo(() => {
        const s = q.trim().toLowerCase().replace(/^@/, '');
        return (data?.players || []).filter((p) => !s || p.viewer.includes(s) || (p.name || '').toLowerCase().includes(s));
    }, [data, q]);
    const kinds = data?.kinds || [];
    const mine = (sel && data?.players.find((p) => p.viewer === sel.viewer)?.bonuses) || {};

    const change = (kind, delta) => {
        if (!sel || !delta) return;
        setBusy(true);
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrf() },
            body: JSON.stringify({ viewer: sel.viewer, kind, delta, name: sel.name !== sel.viewer ? sel.name : null }),
        })
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((d) => { setMsg({ ok: true, text: BONUS_ICONS[kind] + ' ' + (delta > 0 ? '+' : '') + delta + ' → ' + d.balance }); return load(); })
            .catch(() => setMsg({ ok: false, text: t('guessword.bon_failed') }))
            .finally(() => { setBusy(false); setTimeout(() => setMsg(null), 2500); });
    };
    const pickLogin = () => {
        const id = login.trim().replace(/^@/, '').toLowerCase();
        if (!/^[\w.-]+$/u.test(id)) return;
        setSel({ viewer: id, name: seen[id]?.name || id });
        setLogin('');
    };

    if (!data) return <p className="py-6 text-center text-sm text-ink-500">{t('guessword.mon_loading')}</p>;
    const box = 'min-w-0 rounded-xl border border-warm-200 bg-surface px-3 py-2.5';
    const h4 = 'mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500';

    return (
        <div className="grid gap-3 lg:grid-cols-[1fr_1.15fr]">
            <div className={box}>
                <h4 className={h4}>{t('guessword.bon_players')}</h4>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('guessword.bon_search')}
                       className="mb-2 h-9 w-full rounded-lg border-warm-300 bg-surface text-sm text-ink-900" />
                <div className="max-h-[420px] overflow-y-auto">
                    {players.map((p) => {
                        const v = seen[p.viewer] || { name: p.name, avatar: '' };
                        return (
                            <button key={p.viewer} type="button" onClick={() => setSel({ viewer: p.viewer, name: p.name })}
                                    className={'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ' +
                                        (sel?.viewer === p.viewer ? 'bg-primary-100' : 'hover:bg-warm-50')}>
                                <Avatar v={{ ...v, name: p.name }} />
                                <span className="min-w-0 flex-1 truncate">
                                    {p.name}{p.name.toLowerCase() !== p.viewer && <span className="ml-1 text-xs text-ink-500">@{p.viewer}</span>}
                                </span>
                                <span className="flex-none whitespace-nowrap text-xs">
                                    {Object.entries(p.bonuses).map(([k, n]) => (BONUS_ICONS[k] || k) + n).join(' ') || <span className="text-ink-400">0</span>}
                                </span>
                            </button>
                        );
                    })}
                    {!players.length && <p className="py-3 text-center text-sm text-ink-500">{t('guessword.bon_none')}</p>}
                </div>
                {boosts?.length > 0 && <p className="mt-2 text-xs text-ink-500">⚡ {t('guessword.bon_stream_boosts')}: {boosts.join(', ')}</p>}
                <div className="mt-2 border-t border-warm-100 pt-2">
                    <div className="mb-1 text-xs font-semibold text-ink-500">{t('guessword.bon_add_player')}</div>
                    <ViewerPicker value={null} onChange={(v) => v && setSel({ viewer: v.id.toLowerCase(), name: v.name })}
                                  viewers={viewers} placeholder={t('guessword.bon_from_stream')} />
                    <div className="mt-1.5 flex gap-2">
                        <input value={login} onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pickLogin()}
                               placeholder={t('guessword.bon_login_ph')} className="h-9 min-w-0 flex-1 rounded-lg border-warm-300 bg-surface text-sm text-ink-900" />
                        <button type="button" className={btn + ' !h-9'} onClick={pickLogin}>{t('guessword.bon_open')}</button>
                    </div>
                </div>
            </div>

            <div className={box}>
                {!sel && <p className="py-10 text-center text-sm text-ink-500">{t('guessword.bon_pick')}</p>}
                {sel && (
                    <>
                        <div className="mb-3 flex items-center gap-2.5">
                            <Avatar v={{ ...(seen[sel.viewer] || {}), name: sel.name }} size="h-9 w-9" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-bold text-ink-900">{sel.name}</div>
                                <a href={'https://www.tiktok.com/@' + encodeURIComponent(sel.viewer)} target="_blank" rel="noopener noreferrer"
                                   className="text-xs text-primary-700 hover:underline">@{sel.viewer}</a>
                            </div>
                            {msg && <span className={'text-sm font-semibold ' + (msg.ok ? 'text-success-700' : 'text-danger-700')}>{msg.text}</span>}
                        </div>
                        <table className="w-full text-sm">
                            <tbody>
                                {kinds.map((k) => (
                                    <tr key={k} className="border-t border-warm-100">
                                        <td className="py-1 pr-2 text-ink-800">{t('guessword.act_' + k)}</td>
                                        <td className={'w-10 py-1 text-center text-base font-bold ' + (mine[k] ? 'text-ink-900' : 'text-ink-400')}>{mine[k] || 0}</td>
                                        <td className="w-[76px] whitespace-nowrap py-1 text-right">
                                            <button type="button" className={btn} disabled={busy || !mine[k]} onClick={() => change(k, -1)}>−</button>{' '}
                                            <button type="button" className={btn} disabled={busy} onClick={() => change(k, 1)}>+</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-warm-100 pt-3">
                            <span className="text-sm font-semibold text-ink-700">{t('guessword.bon_give')}</span>
                            <select value={give.kind} onChange={(e) => setGive({ ...give, kind: e.target.value })}
                                    className="h-9 min-w-0 flex-1 basis-40 rounded-lg border-warm-300 bg-surface py-0 text-sm text-ink-900">
                                {kinds.map((k) => <option key={k} value={k}>{t('guessword.act_' + k)}</option>)}
                            </select>
                            <input type="number" min={1} max={1000} value={give.n} onChange={(e) => setGive({ ...give, n: e.target.value })}
                                   className="h-9 w-20 rounded-lg border-warm-300 bg-surface text-sm text-ink-900" />
                            <button type="button" disabled={busy || !(+give.n > 0)} onClick={() => change(give.kind, Math.min(1000, Math.floor(+give.n)))}
                                    className="h-9 rounded-lg border border-primary-500 bg-primary-500 px-3 text-sm font-semibold text-white disabled:opacity-40">
                                {t('guessword.bon_give_btn')}
                            </button>
                        </div>
                        <p className="mt-2 text-xs text-ink-500">{t('guessword.bon_note')}</p>
                        {data.log?.length > 0 && (
                            <>
                                <h4 className={h4 + ' mt-3'}>{t('guessword.bon_history')}</h4>
                                <div className="max-h-48 overflow-y-auto text-xs text-ink-600">
                                    {data.log.map((l, i) => (
                                        <div key={i} className="flex gap-2 border-t border-warm-100 py-0.5">
                                            <span className="w-20 flex-none text-ink-500">{when(l.created_at)}</span>
                                            <span className="w-14 flex-none font-semibold">{BONUS_ICONS[l.kind]} {l.delta > 0 ? '+' : ''}{l.delta}</span>
                                            <span className="w-8 flex-none text-ink-500">= {l.balance}</span>
                                            <span className="min-w-0 truncate">{t('guessword.bon_src_' + l.source)}{l.by ? ' · ' + l.by : ''}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
