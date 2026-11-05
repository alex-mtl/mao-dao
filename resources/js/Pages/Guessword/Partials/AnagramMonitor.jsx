import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { Box, btn, clock, hhmm, Kpi, Secret, td, th } from './GameMonitor';
import { Avatar } from './ViewerPicker';

/**
 * The anagram's "game flow" on the room page (the other side of its settings): the round now with the
 * host's controls (pause, +5 min, end the round), this stream's past rounds and its winners.
 */
export default function AnagramMonitor({ s }) {
    const { t } = useLaravelReactI18n();
    const [tab, setTab] = useState('now');
    const [m, setM] = useState(null);
    const [at, setAt] = useState(0);
    const [, tick] = useState(0);
    const [msg, setMsg] = useState(null);

    const load = useCallback(() => s.call('monitor?game=anagram').then((d) => { setM(d); setAt(Date.now()); }).catch(() => {}), [s.call]);
    useEffect(() => {
        load();
        const a = setInterval(load, 2500);
        const b = setInterval(() => tick((n) => n + 1), 500);
        return () => { clearInterval(a); clearInterval(b); };
    }, [load]);

    const control = (cmd, params = {}) =>
        s.call('control', { game: 'anagram', cmd, ...params })
            .then(() => { setMsg({ ok: true, text: t('guessword.mon_done') }); load(); })
            .catch(() => setMsg({ ok: false, text: t('guessword.mon_not_now') }))
            .finally(() => setTimeout(() => setMsg(null), 2500));

    if (!m?.current) return <p className="py-6 text-center text-sm text-ink-500">{t('guessword.mon_loading')}</p>;
    const past = m.past || [];
    const tabs = [['now', '🔴 ' + t('guessword.mon_now')], ['past', t('guessword.mon_past'), past.length], ['leaders', '🏆 ' + t('guessword.an_leaders')]];

    return (
        <div>
            <div className="flex items-center gap-1 overflow-x-auto border-b border-warm-200 px-3">
                {tabs.map(([k, label, n]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                            className={'h-10 whitespace-nowrap border-b-2 px-3 text-sm font-semibold ' +
                                (k === tab ? 'border-primary-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800')}>
                        {label}{n !== undefined && <span className="ml-1.5 rounded-full bg-warm-100 px-1.5 text-[11px]">{n}</span>}
                    </button>
                ))}
                {m.active !== 'anagram' && <span className="ml-auto whitespace-nowrap text-xs text-warning-700">{t('guessword.an_inactive')}</span>}
            </div>

            <div className="p-4">
                {tab === 'now' && <Now c={m.current} run={m.current.paused ? 0 : (Date.now() - at) / 1000} control={control} t={t} />}
                {tab === 'past' && <Past past={past} t={t} />}
                {tab === 'leaders' && <Leaders rows={m.leaders || []} t={t} />}
            </div>

            {msg && (
                <div className={'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg '
                    + (msg.ok ? 'bg-success-500' : 'bg-danger-500')}>{msg.text}</div>
            )}
        </div>
    );
}

function Now({ c, run, control, t }) {
    const playing = c.phase === 'playing';
    const left = playing ? c.left - run : c.phaseLeft - run;
    return (
        <>
            <div className="flex flex-wrap gap-3">
                <Kpi label={t('guessword.mon_round', { n: c.round })} sub={c.word ? t('guessword.an_letters', { n: c.word.length }) : null}>
                    {c.word ? <Secret word={c.word} big /> : '—'}
                </Kpi>
                <Kpi label={c.paused ? '⏸ ' + t('guessword.mon_paused') : t('guessword.mon_phase_' + c.phase)}
                     sub={playing ? t('guessword.mon_of', { d: clock(c.duration), e: clock(c.duration - left) }) : null}>
                    {c.phase === 'idle' || c.phase === 'finished' ? '—' : clock(left)}
                </Kpi>
                <Kpi label={t('guessword.an_found_kpi')} sub={t('guessword.an_of_possible', { n: c.possible })}>{c.found}</Kpi>
                <Kpi label={t('guessword.mon_players')}>{c.players}</Kpi>
                <Kpi label={t('guessword.an_longest')} sub={c.longest?.name}>{c.longest ? c.longest.word : '—'}</Kpi>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                {c.paused
                    ? <button type="button" className={btn + ' !border-primary-500 !bg-primary-500 !text-white'} onClick={() => control('resume')}>▶ {t('guessword.mon_resume')}</button>
                    : <button type="button" className={btn} onClick={() => control('pause')}>⏸ {t('guessword.mon_pause')}</button>}
                <button type="button" className={btn} disabled={!playing} onClick={() => control('extend', { min: 5 })}>+5 {t('guessword.mon_min')}</button>
                <button type="button" className={btn + ' text-danger-600'} disabled={!playing || c.paused}
                        onClick={() => confirm(t('guessword.an_finish_q')) && control('finish')}>⏹ {t('guessword.an_finish')}</button>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <Box title={t('guessword.mon_people')}>
                    <div className="max-h-96 overflow-auto">
                        <table className="w-full border-collapse">
                            <thead><tr><th className={th}>{t('guessword.mon_place')}</th><th className={th}>{t('guessword.mon_player')}</th>
                                <th className={th + ' text-right'}>{t('guessword.an_points')}</th><th className={th + ' text-right'}>{t('guessword.mon_words')}</th></tr></thead>
                            <tbody>
                                {c.people.map((p, i) => (
                                    <tr key={p.id}>
                                        <td className={td + ' text-ink-500'}>{i + 1}</td>
                                        <td className={td}><span className="flex min-w-0 max-w-[15rem] items-center gap-1.5"><Avatar v={p} size="h-5 w-5" /><span className="truncate">{p.name}</span></span></td>
                                        <td className={td + ' text-right font-bold'}>{p.score}</td>
                                        <td className={td + ' text-right text-ink-500'}>{p.words}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!c.people.length && <p className="py-3 text-sm text-ink-500">{t('guessword.mon_empty')}</p>}
                    </div>
                </Box>
                <Box title={t('guessword.an_words')}>
                    <div className="max-h-96 overflow-auto">
                        <table className="w-full border-collapse">
                            <thead><tr><th className={th}>{t('guessword.mon_word')}</th><th className={th}>{t('guessword.mon_who')}</th>
                                <th className={th + ' text-right'}>{t('guessword.an_repeats')}</th></tr></thead>
                            <tbody>
                                {c.words.map((w) => (
                                    <tr key={w.w}>
                                        <td className={td + ' font-bold'}>{w.w}</td>
                                        <td className={td}><span className="block max-w-[12rem] truncate">{w.name}</span></td>
                                        <td className={td + ' text-right text-ink-500'}>{w.n > 1 ? '×' + w.n : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!c.words.length && <p className="py-3 text-sm text-ink-500">{t('guessword.mon_empty')}</p>}
                    </div>
                </Box>
            </div>
        </>
    );
}

function Past({ past, t }) {
    const wins = {};
    past.forEach((r) => { if (r.winner) wins[r.winner] = (wins[r.winner] || 0) + 1; });
    const champ = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
    const first = past[past.length - 1];
    return (
        <>
            <div className="mb-3 flex flex-wrap gap-3">
                <Kpi label={t('guessword.mon_stream')} sub={first ? t('guessword.mon_since', { t: hhmm(first.at) }) : null}>{t('guessword.mon_rounds', { n: past.length })}</Kpi>
                <Kpi label={t('guessword.mon_champ')} sub={champ ? t('guessword.mon_wins', { n: champ[1] }) : null}>{champ ? champ[0] : '—'}</Kpi>
            </div>
            <div className="overflow-x-auto rounded-xl border border-warm-200 bg-surface px-2 py-1">
                <table className="w-full border-collapse">
                    <thead><tr>
                        <th className={th}>#</th><th className={th}>{t('guessword.mon_word')}</th><th className={th}>{t('guessword.an_winner')}</th>
                        <th className={th}>{t('guessword.an_podium')}</th><th className={th}>{t('guessword.an_found_col')}</th>
                        <th className={th}>{t('guessword.mon_players')}</th><th className={th}>{t('guessword.an_longest')}</th><th className={th}>{t('guessword.an_end')}</th>
                    </tr></thead>
                    <tbody>
                        {past.map((r) => (
                            <tr key={r.round + '-' + r.at}>
                                <td className={td + ' text-ink-500'}>{r.round}</td>
                                <td className={td + ' font-bold'}>{(r.word || '').toUpperCase()}</td>
                                <td className={td}>{r.winner
                                    ? <><span className="font-medium">🏆 {r.winner}</span> <span className="text-xs text-ink-500">{r.score}</span></>
                                    : <span className="rounded-full bg-warm-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
                                          {r.reason === 'skip' ? '⏭ ' + t('guessword.mon_r_skip') : t('guessword.an_nobody')}</span>}</td>
                                <td className={td + ' text-ink-600'}>{(r.podium || []).slice(1).join(', ')}</td>
                                <td className={td}>{r.found} / {r.possible}</td>
                                <td className={td}>{r.players}</td>
                                <td className={td}>{r.longest ? r.longest[0].toUpperCase() + ' · ' + r.longest[1] : '—'}</td>
                                <td className={td + ' text-ink-500'}>{hhmm(r.at)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!past.length && <p className="py-4 text-center text-sm text-ink-500">{t('guessword.mon_no_rounds')}</p>}
            </div>
        </>
    );
}

function Leaders({ rows, t }) {
    return (
        <div className="overflow-x-auto rounded-xl border border-warm-200 bg-surface px-2 py-1">
            <table className="w-full border-collapse">
                <thead><tr><th className={th}>{t('guessword.mon_place')}</th><th className={th}>{t('guessword.mon_player')}</th>
                    <th className={th + ' text-right'}>{t('guessword.an_wins')}</th><th className={th + ' text-right'}>{t('guessword.an_podiums')}</th>
                    <th className={th + ' text-right'}>{t('guessword.an_streak')}</th></tr></thead>
                <tbody>
                    {rows.map((p, i) => (
                        <tr key={p.name + i}>
                            <td className={td + ' text-ink-500'}>{i + 1}</td>
                            <td className={td}><span className="flex min-w-0 max-w-[15rem] items-center gap-1.5"><Avatar v={p} size="h-5 w-5" /><span className="truncate">{p.name}</span></span></td>
                            <td className={td + ' text-right font-bold'}>{p.wins}</td>
                            <td className={td + ' text-right'}>{p.podiums}</td>
                            <td className={td + ' text-right text-ink-500'}>{p.streak > 1 ? '🔥' + p.streak : ''}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {!rows.length && <p className="py-4 text-center text-sm text-ink-500">{t('guessword.mon_no_rounds')}</p>}
        </div>
    );
}
