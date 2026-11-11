import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { Box, clock, hhmm, Kpi, td, th } from './GameMonitor';

const num = (n) => Number(n || 0).toLocaleString();
const RESULT_STYLE = { win: 'text-success-700', loss: 'text-danger-700', draw: 'text-ink-700' };

/**
 * Listen mode ("прослушка"): the game is not run from here, the engine only listens to the LIVE the streamer
 * runs from the phone. This is the view of what it heard: the LIVE's counters, the battles with their rounds
 * (sub-rounds of one match share a channel), the most active viewers. Data: engine /api/monitor?game=listen.
 */
export default function ListenMonitor({ s }) {
    const { t } = useLaravelReactI18n();
    const [tab, setTab] = useState('battles');
    const [m, setM] = useState(null);
    const [, tick] = useState(0);

    const load = useCallback(() => s.call('monitor?game=listen').then(setM).catch(() => {}), [s.call]);
    useEffect(() => {
        load();
        const a = setInterval(load, 3000);
        const b = setInterval(() => tick((n) => n + 1), 1000);
        return () => { clearInterval(a); clearInterval(b); };
    }, [load]);

    if (!m?.stats) return <p className="py-6 text-center text-sm text-ink-500">{t('guessword.mon_loading')}</p>;
    const tot = m.stats.totals;
    const tabs = [['battles', '⚔ ' + t('guessword.lis_battles'), m.battles.totals.battles], ['stats', '📈 ' + t('guessword.lis_stats')], ['tops', '🏆 ' + t('guessword.lis_tops')]];

    return (
        <div>
            <div className="flex flex-wrap gap-2 px-5 pb-1 pt-4">
                <Kpi label={t('guessword.lis_viewers')}>{num(tot.viewers)}</Kpi>
                <Kpi label={t('guessword.lis_comments')}>{num(tot.comments)}</Kpi>
                <Kpi label={t('guessword.lis_likes')}>{num(tot.likes)}</Kpi>
                <Kpi label={t('guessword.lis_gifts')} sub={t('guessword.lis_coins', { n: num(tot.coins) })}>{num(tot.gifts)}</Kpi>
                <Kpi label={t('guessword.lis_follows')}>{num(tot.follows)}</Kpi>
                <Kpi label={t('guessword.lis_subs')}>{num(tot.subs)}</Kpi>
            </div>
            <p className="px-5 pb-1 text-xs text-ink-500">{t('guessword.lis_since', { time: hhmm(m.stats.started) })} · {t('guessword.lis_note')}</p>
            <div className="flex items-center gap-1 overflow-x-auto border-b border-warm-200 px-3">
                {tabs.map(([k, label, n]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                            className={'h-10 whitespace-nowrap border-b-2 px-3 text-sm font-semibold ' +
                                       (k === tab ? 'border-primary-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800')}>
                        {label}{n ? <span className="ml-1.5 rounded-full bg-warm-100 px-1.5 text-xs text-ink-600">{n}</span> : null}
                    </button>
                ))}
            </div>
            <div className="space-y-3 px-5 py-4">
                {tab === 'battles' && <Battles b={m.battles} t={t} />}
                {tab === 'stats' && <Stats st={m.stats} t={t} />}
                {tab === 'tops' && <Tops st={m.stats} t={t} />}
            </div>
        </div>
    );
}

function Result({ r, t }) {
    if (!r) return <span className="text-ink-400">—</span>;
    return <span className={'font-semibold ' + (RESULT_STYLE[r] || 'text-ink-500')}>{t('guessword.lis_res_' + r)}</span>;
}

/** the two scores as one bar: ours (left) against the rival (right) */
function ScoreBar({ ours, theirs, known }) {
    const sum = ours + theirs;
    const pct = sum ? Math.round((ours / sum) * 100) : 50;
    return (
        <div className="h-3 overflow-hidden rounded-full bg-danger-200">
            <div className={'h-full ' + (known ? 'bg-success-500' : 'bg-primary-500')} style={{ width: pct + '%' }} />
        </div>
    );
}

function Battles({ b, t }) {
    const c = b.current;
    const tot = b.totals;
    return (
        <>
            {c ? (
                <Box title={'🔴 ' + t('guessword.lis_battle_now') + ' · ' + t('guessword.lis_round', { n: c.round })}>
                    <div className="flex items-baseline justify-between gap-3 text-lg font-bold text-ink-900">
                        <span>{c.known ? t('guessword.lis_us') : 'A'}: {num(c.ours)}</span>
                        <span className="truncate text-sm font-semibold text-ink-500">{c.rival || '?'}</span>
                        <span>{num(c.theirs)}</span>
                    </div>
                    <ScoreBar ours={c.ours} theirs={c.theirs} known={c.known} />
                    <p className="mt-2 text-xs text-ink-500">
                        {t('guessword.lis_elapsed', { t: clock(c.elapsed) })}
                        {c.duration ? ' / ' + clock(c.duration) : ''}
                        {c.extra ? ' · ' + t('guessword.lis_extra', { n: c.extra }) : ''}
                        {c.mid ? ' · ' + t('guessword.lis_midway') : ''}
                    </p>
                    <During d={c.during} t={t} />
                    <Support c={c} t={t} />
                </Box>
            ) : (
                <p className="rounded-xl bg-warm-50 px-4 py-3 text-sm text-ink-600">{t('guessword.lis_no_battle')}</p>
            )}

            {b.series.length > 0 && (
                <Box title={t('guessword.lis_series')}>
                    <div className="flex flex-wrap gap-2">
                        {b.series.map((x) => (
                            <div key={x.id} className="rounded-lg border border-warm-200 px-3 py-1.5 text-sm">
                                <div className="text-[11px] font-semibold uppercase text-ink-500">{t('guessword.lis_round', { n: x.round })}</div>
                                <div className="font-bold text-ink-900">{num(x.ours)} : {num(x.theirs)}</div>
                                <Result r={x.result} t={t} />
                            </div>
                        ))}
                    </div>
                </Box>
            )}

            <Box title={t('guessword.lis_history')}>
                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-700">
                    <span>{t('guessword.lis_total', { n: tot.battles })}</span>
                    <span className="text-success-700">{t('guessword.lis_res_win')}: {tot.win}</span>
                    <span className="text-danger-700">{t('guessword.lis_res_loss')}: {tot.loss}</span>
                    <span>{t('guessword.lis_res_draw')}: {tot.draw}</span>
                    <span>{t('guessword.lis_points', { a: num(tot.points_for), b: num(tot.points_against) })}</span>
                </div>
                {b.recent.length === 0 ? <p className="text-sm text-ink-500">{t('guessword.lis_none')}</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead><tr>
                                <th className={th}>{t('guessword.lis_col_time')}</th>
                                <th className={th}>{t('guessword.lis_col_round')}</th>
                                <th className={th}>{t('guessword.lis_col_rival')}</th>
                                <th className={th}>{t('guessword.lis_col_score')}</th>
                                <th className={th}>{t('guessword.lis_col_result')}</th>
                                <th className={th}>{t('guessword.lis_col_during')}</th>
                            </tr></thead>
                            <tbody>
                                {b.recent.map((x) => (
                                    <tr key={x.id + ':' + x.t0}>
                                        <td className={td}>{hhmm(x.t0)}</td>
                                        <td className={td}>{x.round}{x.extra ? '+' : ''}</td>
                                        <td className={td + ' max-w-[10rem] truncate'}>{x.rival || '?'}</td>
                                        <td className={td}>{num(x.ours)} : {num(x.theirs)}</td>
                                        <td className={td}>{x.result === 'unfinished' ? <span className="text-ink-500">{t('guessword.lis_res_unfinished')}</span> : <Result r={x.result} t={t} />}</td>
                                        <td className={td + ' text-ink-600'}>{duringText(x.during, t)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Box>
        </>
    );
}

function duringText(d, t) {
    if (!d) return '';
    return [['comments', '💬'], ['likes', '❤'], ['gifts', '🎁'], ['follows', '➕'], ['subs', '⭐']]
        .filter(([k]) => d[k]).map(([k, i]) => i + num(d[k])).join(' ');
}

function During({ d, t }) {
    const text = duringText(d, t);
    return text ? <p className="mt-2 text-sm text-ink-700">{t('guessword.lis_during')}: {text}{d.coins ? ' · ' + t('guessword.lis_coins', { n: num(d.coins) }) : ''}</p> : null;
}

function Support({ c, t }) {
    const sides = Object.entries(c.support || {}).filter(([, people]) => people.length);
    if (!sides.length) return null;
    const name = (id) => c.sides.find((x) => x.id === id);
    return (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {sides.map(([id, people]) => (
                <div key={id}>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                        {name(id)?.host ? t('guessword.lis_us') : (name(id)?.name || id)} · {t('guessword.lis_supporters')}
                    </div>
                    {people.slice(0, 5).map((p) => (
                        <div key={p.id} className="flex justify-between gap-2 text-sm"><span className="truncate">{p.name || p.id}</span><span className="font-semibold">{num(p.score)}</span></div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function Stats({ st, t }) {
    const kinds = [['comments', 'bg-primary-400'], ['likes', 'bg-secondary-400'], ['joins', 'bg-accent-400']];
    const max = Math.max(1, ...st.line.map((r) => Math.max(...kinds.map(([k]) => r[k] || 0))));
    return (
        <>
            <Box title={t('guessword.lis_per_minute')}>
                <div className="flex h-28 items-end gap-px">
                    {st.line.map((r) => (
                        <div key={r.m} className="flex h-full min-w-[3px] flex-1 items-end gap-px" title={`${r.m} min`}>
                            {kinds.map(([k, color]) => <div key={k} className={'flex-1 rounded-t ' + color} style={{ height: ((r[k] || 0) / max) * 100 + '%' }} />)}
                        </div>
                    ))}
                </div>
                <div className="mt-2 flex gap-4 text-xs text-ink-600">
                    {kinds.map(([k, color]) => <span key={k} className="flex items-center gap-1"><i className={'inline-block h-2.5 w-2.5 rounded-sm ' + color} />{t('guessword.lis_' + k)}</span>)}
                </div>
            </Box>
            <Box title={t('guessword.lis_gift_kinds')}>
                {st.gifts.length === 0 ? <p className="text-sm text-ink-500">{t('guessword.lis_none')}</p> : st.gifts.map((g) => (
                    <div key={g.gift} className="flex justify-between gap-2 text-sm"><span className="truncate">{g.gift} ×{num(g.n)}</span><span className="font-semibold">{t('guessword.lis_coins', { n: num(g.coins) })}</span></div>
                ))}
            </Box>
        </>
    );
}

function Tops({ st, t }) {
    const list = (rows, unit) => (rows.length === 0 ? <p className="text-sm text-ink-500">{t('guessword.lis_none')}</p> : rows.map((r, i) => (
        <div key={r.id} className="flex justify-between gap-2 text-sm"><span className="truncate">{i + 1}. {r.name || r.id}</span><span className="font-semibold">{num(r.n)}{unit}</span></div>
    )));
    return (
        <div className="grid gap-3 sm:grid-cols-3">
            <Box title={'🎁 ' + t('guessword.lis_top_gifters')}>{list(st.top.coins, '')}</Box>
            <Box title={'❤ ' + t('guessword.lis_top_likers')}>{list(st.top.likes, '')}</Box>
            <Box title={'💬 ' + t('guessword.lis_top_chatters')}>{list(st.top.comments, '')}</Box>
        </div>
    );
}
