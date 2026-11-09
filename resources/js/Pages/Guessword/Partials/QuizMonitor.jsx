import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { Box, btn, clock, hhmm, Kpi, Secret, td, th } from './GameMonitor';
import PlayerBonuses from './PlayerBonuses';
import { Avatar } from './ViewerPicker';

export const QUIZ_TOPICS = ['geography', 'sports', 'literature', 'art', 'movies', 'music', 'science', 'history'];
export const TOPIC_ICON = { geography: '🌍', sports: '⚽', literature: '📚', art: '🎨', movies: '🎬', music: '🎵', science: '🔬', history: '🏛' };
const pts = (x) => (Number.isInteger(x) ? String(x) : Number(x).toFixed(1));

/**
 * The quiz's "game flow" on the room page (the other side of its settings): the round now (the question, its
 * variants, the points) with the host's controls, this stream's past rounds, the topics planned for the next
 * rounds and the players' bonuses.
 */
export default function QuizMonitor({ s, bonusesUrl }) {
    const { t } = useLaravelReactI18n();
    const [tab, setTab] = useState('now');
    const [m, setM] = useState(null);
    const [at, setAt] = useState(0);
    const [, tick] = useState(0);
    const [msg, setMsg] = useState(null);

    const load = useCallback(() => s.call('monitor?game=quiz').then((d) => { setM(d); setAt(Date.now()); }).catch(() => {}), [s.call]);
    useEffect(() => {
        load();
        const a = setInterval(load, 2000);
        const b = setInterval(() => tick((n) => n + 1), 500);
        return () => { clearInterval(a); clearInterval(b); };
    }, [load]);

    const control = (cmd, params = {}) =>
        s.call('control', { game: 'quiz', cmd, ...params })
            .then(() => { setMsg({ ok: true, text: t('guessword.mon_done') }); load(); })
            .catch(() => setMsg({ ok: false, text: t('guessword.mon_not_now') }))
            .finally(() => setTimeout(() => setMsg(null), 2500));

    if (!m?.current) return <p className="py-6 text-center text-sm text-ink-500">{t('guessword.mon_loading')}</p>;
    const past = m.past || [];
    const tabs = [['now', '🔴 ' + t('guessword.mon_now')], ['past', t('guessword.mon_past'), past.length],
                  ['plan', t('guessword.mon_plan'), m.plan.queue.length + 1],
                  ...(bonusesUrl ? [['bonuses', '🎁 ' + t('guessword.bon_tab')]] : [])];

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
                {m.active !== 'quiz' && <span className="ml-auto whitespace-nowrap text-xs text-warning-700">{t('guessword.qz_inactive')}</span>}
            </div>

            <div className="p-4">
                {tab === 'now' && <Now c={m.current} run={m.current.paused ? 0 : (Date.now() - at) / 1000} control={control} t={t} />}
                {tab === 'past' && <Past past={past} t={t} />}
                {tab === 'plan' && <Plan plan={m.plan} c={m.current} control={control} t={t} />}
                {tab === 'bonuses' && bonusesUrl && <PlayerBonuses url={bonusesUrl} call={s.call} boosts={[]} />}
            </div>

            {msg && (
                <div className={'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg '
                    + (msg.ok ? 'bg-success-500' : 'bg-danger-500')}>{msg.text}</div>
            )}
        </div>
    );
}

export const topicLabel = (t, k) => (k ? (TOPIC_ICON[k] || '') + ' ' + t('guessword.qz_t_' + k) : '—');

function Now({ c, run, control, t }) {
    const asking = c.phase === 'ask';
    const shown = c.phase === 'answer' || c.phase === 'winner' || c.phase === 'reveal';
    const left = asking ? c.left - run : c.phaseLeft - run;
    const inRound = ['topic', 'intro', 'ask', 'answer'].includes(c.phase);
    return (
        <>
            <div className="flex flex-wrap gap-3">
                <Kpi label={t('guessword.mon_round', { n: c.round })} sub={c.quiz?.title}>{topicLabel(t, c.topic)}</Kpi>
                <Kpi label={t('guessword.qz_question')} sub={t('guessword.qz_phase_' + c.phase)}>{c.of ? Math.min(c.n, c.of) + ' / ' + c.of : '—'}</Kpi>
                <Kpi label={c.paused ? '⏸ ' + t('guessword.mon_paused') : t('guessword.qz_left')} sub={t('guessword.qz_of_sec', { n: c.qtime })}>
                    {asking || c.phase === 'reveal' || c.phase === 'winner' ? clock(left) : '—'}
                </Kpi>
                <Kpi label={t('guessword.qz_answered')} sub={t('guessword.qz_variants_of', { n: c.variants.length, max: c.variantsMax })}>{c.answered}</Kpi>
            </div>

            {c.question && (
                <Box title={t('guessword.qz_q_and_a')} className="mt-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base">
                        <span className="font-bold text-ink-900">{c.question}</span>
                        <span className="text-ink-500">→</span>
                        <span className="font-bold text-success-700">{shown ? c.answer : <Secret word={c.answer} />}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">{t('guessword.qz_wrong')}: {c.wrong.join(', ')}</p>
                </Box>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
                {c.paused
                    ? <button type="button" className={btn + ' !border-primary-500 !bg-primary-500 !text-white'} onClick={() => control('resume')}>▶ {t('guessword.mon_resume')}</button>
                    : <button type="button" className={btn} onClick={() => control('pause')}>⏸ {t('guessword.mon_pause')}</button>}
                <button type="button" className={btn} disabled={!asking} onClick={() => control('extend', { sec: 10 })}>+10 {t('guessword.qz_sec')}</button>
                <button type="button" className={btn} disabled={!asking || c.paused} onClick={() => control('reveal')}>👁 {t('guessword.qz_reveal')}</button>
                <button type="button" className={btn} disabled={!(asking || c.phase === 'intro') || c.paused}
                        onClick={() => confirm(t('guessword.qz_skip_q')) && control('skip')}>⏭ {t('guessword.qz_skip')}</button>
                <button type="button" className={btn + ' text-danger-600'} disabled={!inRound || c.paused}
                        onClick={() => confirm(t('guessword.qz_finish_q')) && control('finish')}>⏹ {t('guessword.qz_finish')}</button>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1.25fr_1fr]">
                <Box title={t('guessword.qz_table')}>
                    <div className="max-h-96 overflow-auto">
                        <table className="w-full border-collapse">
                            <thead><tr><th className={th}>{t('guessword.qz_variant')}</th><th className={th}>{t('guessword.qz_first')}</th>
                                <th className={th + ' text-right'}>{t('guessword.qz_now_for')}</th><th className={th + ' text-right'}>{t('guessword.mon_when')}</th></tr></thead>
                            <tbody>
                                {c.variants.map((v) => (
                                    <tr key={v.w} className={v.right && shown ? 'bg-success-50' : ''}>
                                        <td className={td + ' font-bold'}>{v.w}{v.right && shown && <span className="ml-1 text-success-700">✓</span>}</td>
                                        <td className={td}><span className="block max-w-[12rem] truncate">{v.author}</span></td>
                                        <td className={td + ' text-right'}>{v.n}</td>
                                        <td className={td + ' text-right text-ink-500'}>{clock(v.t)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!c.variants.length && <p className="py-3 text-sm text-ink-500">{t('guessword.mon_empty')}</p>}
                    </div>
                </Box>
                <Box title={t('guessword.qz_points')}>
                    <div className="max-h-96 overflow-auto">
                        <table className="w-full border-collapse">
                            <thead><tr><th className={th}>{t('guessword.mon_place')}</th><th className={th}>{t('guessword.mon_player')}</th>
                                <th className={th + ' text-right'}>{t('guessword.qz_round_pts')}</th><th className={th + ' text-right'}>{t('guessword.qz_right')}</th>
                                <th className={th + ' text-right'} title={t('guessword.an_wins')}>🏆</th></tr></thead>
                            <tbody>
                                {c.people.map((p, i) => (
                                    <tr key={p.id}>
                                        <td className={td + ' text-ink-500'}>{i + 1}</td>
                                        <td className={td}><span className="flex min-w-0 max-w-[13rem] items-center gap-1.5"><Avatar v={p} size="h-5 w-5" /><span className="truncate">{p.name}</span></span></td>
                                        <td className={td + ' text-right font-bold'}>{pts(p.score)}</td>
                                        <td className={td + ' text-right text-ink-500'}>{p.right}</td>
                                        <td className={td + ' text-right text-ink-500'}>{p.wins || ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!c.people.length && <p className="py-3 text-sm text-ink-500">{t('guessword.qz_no_points')}</p>}
                    </div>
                </Box>
            </div>

            <Box title={t('guessword.mon_log')} className="mt-3">
                <div className="max-h-60 overflow-auto text-sm">
                    {c.log.map((e, i) => (
                        <div key={i} className="border-t border-warm-100 py-1 first:border-t-0">
                            <span className="mr-2 text-xs text-ink-500">{hhmm(e.t)}</span>{t('guessword.qz_ev_' + e.type, e)}
                        </div>
                    ))}
                    {!c.log.length && <p className="text-ink-500">{t('guessword.mon_empty')}</p>}
                </div>
            </Box>
        </>
    );
}

function Past({ past, t }) {
    const [open, setOpen] = useState(null);
    const wins = {};
    past.forEach((r) => (r.winner || '').split(', ').filter(Boolean).forEach((n) => { wins[n] = (wins[n] || 0) + 1; }));
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
                        <th className={th}>#</th><th className={th}>{t('guessword.qz_topic')}</th><th className={th}>{t('guessword.an_winner')}</th>
                        <th className={th}>{t('guessword.an_podium')}</th><th className={th}>{t('guessword.mon_players')}</th><th className={th}>{t('guessword.an_end')}</th>
                    </tr></thead>
                    <tbody>
                        {past.map((r, i) => (
                            <PastRow key={r.round + '-' + r.at} r={r} open={open === i} toggle={() => setOpen(open === i ? null : i)} t={t} />
                        ))}
                    </tbody>
                </table>
                {!past.length && <p className="py-4 text-center text-sm text-ink-500">{t('guessword.mon_no_rounds')}</p>}
            </div>
        </>
    );
}

function PastRow({ r, open, toggle, t }) {
    return (
        <>
            <tr className="cursor-pointer hover:bg-warm-50" onClick={toggle}>
                <td className={td + ' text-ink-500'}>{open ? '▾' : '▸'} {r.round}</td>
                <td className={td}><span className="font-medium">{topicLabel(t, r.topic)}</span> <span className="text-xs text-ink-500">{r.quiz}</span></td>
                <td className={td}>{r.winner
                    ? <><span className="font-medium">🏆 {r.winner}</span> <span className="text-xs text-ink-500">{pts(r.score)}</span></>
                    : <span className="rounded-full bg-warm-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600">{t('guessword.an_nobody')}</span>}</td>
                <td className={td + ' text-ink-600'}>{(r.podium || []).slice(1).map((p) => p[0] + ' ' + pts(p[1])).join(', ')}</td>
                <td className={td}>{r.players}</td>
                <td className={td + ' text-ink-500'}>{hhmm(r.at)}</td>
            </tr>
            {open && (
                <tr><td colSpan={6} className="bg-warm-50 px-3 py-2">
                    <table className="w-full border-collapse">
                        <thead><tr><th className={th}>#</th><th className={th}>{t('guessword.qz_question')}</th><th className={th}>{t('guessword.qz_answer')}</th>
                            <th className={th + ' text-right'}>{t('guessword.qz_variants')}</th><th className={th + ' text-right'}>{t('guessword.qz_got_it')}</th>
                            <th className={th}>{t('guessword.qz_first_right')}</th></tr></thead>
                        <tbody>
                            {(r.questions || []).map((q, j) => (
                                <tr key={j}>
                                    <td className={td + ' text-ink-500'}>{j + 1}</td>
                                    <td className={td + ' whitespace-normal'}>{q.q}</td>
                                    <td className={td + ' font-bold'}>{q.a}</td>
                                    <td className={td + ' text-right'}>{q.variants}</td>
                                    <td className={td + ' text-right'}>{q.right} / {q.answered}</td>
                                    <td className={td}>{q.first || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </td></tr>
            )}
        </>
    );
}

function Plan({ plan, c, control, t }) {
    const [topic, setTopic] = useState(plan.available[0] || QUIZ_TOPICS[0]);
    const inRound = ['topic', 'intro', 'ask', 'answer'].includes(c.phase);
    return (
        <>
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-warm-200 bg-surface px-3 py-2.5">
                <span className="text-ink-500">→</span>
                <span className="font-semibold text-ink-900">{t('guessword.qz_next_round')}</span>
                <span className="rounded-full bg-warm-100 px-2 py-0.5 text-xs font-semibold text-ink-700">
                    {plan.queue[0] ? topicLabel(t, plan.queue[0]) : t('guessword.qz_random_topic')}
                </span>
                <span className="ml-auto text-xs text-ink-500">
                    {inRound ? t('guessword.qz_after_round', { n: c.round }) : c.phase === 'reveal' || c.phase === 'winner' ? clock(c.phaseLeft) : ''}
                </span>
            </div>
            {plan.queue.slice(1).map((k, i) => (
                <div key={i} className="mb-2 flex items-center gap-3 rounded-xl border border-warm-200 bg-surface px-3 py-2">
                    <span className="w-6 font-bold text-ink-500">{i + 2}</span>
                    <span className="font-medium">{topicLabel(t, k)}</span>
                    <span className="ml-auto flex gap-1.5">
                        <button type="button" className={btn} onClick={() => control('queue_move', { i: i + 1, to: i })}>↑</button>
                        <button type="button" className={btn} onClick={() => control('queue_del', { i: i + 1 })}>✕</button>
                    </span>
                </div>
            ))}
            {plan.queue[0] && (
                <button type="button" className={btn + ' mb-2'} onClick={() => control('queue_del', { i: 0 })}>✕ {t('guessword.qz_unplan_next')}</button>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <select className="h-9 rounded-lg border-warm-300 bg-surface py-0 text-sm text-ink-900" value={topic} onChange={(e) => setTopic(e.target.value)}>
                    {QUIZ_TOPICS.map((k) => <option key={k} value={k} disabled={!plan.available.includes(k)}>{topicLabel(t, k)}</option>)}
                </select>
                <button type="button" className={btn + ' !border-primary-500 !bg-primary-500 !text-white'} onClick={() => control('queue_add', { topic })}>
                    {t('guessword.qz_queue_add')}
                </button>
            </div>
            <p className="mt-2 text-xs text-ink-500">{t('guessword.qz_plan_help')}</p>
        </>
    );
}
