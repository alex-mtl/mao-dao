import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from './ViewerPicker';

const clock = (s) => Math.floor(Math.max(0, s) / 60) + ':' + String(Math.round(Math.max(0, s)) % 60).padStart(2, '0');
const hhmm = (t) => (t ? new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const hms = (t) => (t ? new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
// the rank's colour, as on the stream: hot -> cold
const rankCls = (r) => (r <= 1 ? 'bg-success-500' : r < 300 ? 'bg-danger-500' : r < 1000 ? 'bg-warning-500' : r < 5000 ? 'bg-warning-300' : 'bg-ink-400');
const Rank = ({ r }) => (r ? <span className={'inline-block min-w-[2.6rem] rounded-md px-1.5 text-center text-xs font-bold text-white ' + rankCls(r)}>{r}</span> : <span className="text-ink-400">—</span>);

/** the player's TikTok and, when they linked it in the bot, Telegram - small round links */
function Links({ p }) {
    const icon = 'flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-white hover:opacity-80';
    const tg = p.tg;
    return (
        <span className="ml-1 inline-flex flex-none items-center gap-1">
            {p.id && (
                <a href={'https://www.tiktok.com/@' + encodeURIComponent(p.id)} target="_blank" rel="noopener noreferrer"
                   title={'TikTok @' + p.id} className={icon + ' bg-black'} onClick={(e) => e.stopPropagation()}>
                    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="currentColor"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9a7.4 7.4 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5z" /></svg>
                </a>
            )}
            {tg && (
                <a href={tg.tg ? 'https://t.me/' + encodeURIComponent(tg.tg) : 'tg://user?id=' + encodeURIComponent(tg.id)} target="_blank" rel="noopener noreferrer"
                   title={'Telegram ' + (tg.tg ? '@' + tg.tg : tg.full || tg.id)} className={icon + ' bg-[#229ED9]'}>
                    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="currentColor"><path d="M9.8 15.3l-.4 5.4c.6 0 .8-.3 1.1-.6l2.6-2.5 5.5 4c1 .6 1.7.3 2-.9l3.6-16.9c.3-1.5-.6-2.1-1.6-1.7L1.4 10.3c-1.4.6-1.4 1.4-.2 1.7l5.4 1.7L19 5.9c.6-.4 1.1-.2.7.2z" /></svg>
                </a>
            )}
        </span>
    );
}

function Kpi({ label, children, sub }) {
    return (
        <div className="min-w-0 flex-1 basis-36 rounded-xl border border-warm-200 bg-surface px-3 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
            <div className="truncate text-xl font-bold text-ink-900">{children}</div>
            {sub && <div className="truncate text-xs text-ink-500">{sub}</div>}
        </div>
    );
}

function Box({ title, children, className = '' }) {
    return (
        <div className={'min-w-0 rounded-xl border border-warm-200 bg-surface px-3 py-2.5 ' + className}>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{title}</h4>
            {children}
        </div>
    );
}

/** a secret word: blurred until the host looks (the page may be on the stream's screen) */
function Secret({ word, big }) {
    const [show, setShow] = useState(false);
    if (!word) return <span className="text-ink-400">—</span>;
    return (
        <span className="inline-flex items-center gap-2">
            <span className={(big ? 'tracking-wide ' : '') + 'transition ' + (show ? '' : 'select-none blur-[6px]')}>{word}</span>
            <button type="button" onClick={() => setShow(!show)} className="rounded-md bg-warm-100 px-1.5 text-xs font-medium text-ink-700">
                {show ? '🙈' : '👁'}
            </button>
        </span>
    );
}

const th = 'px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500';
const td = 'whitespace-nowrap border-t border-warm-100 px-1.5 py-px text-sm leading-5';
const btn = 'h-9 rounded-lg border border-warm-300 bg-surface px-3 text-sm font-semibold text-ink-800 hover:bg-warm-50 disabled:opacity-40';

/**
 * The room page's monitor of the guess game (instead of the settings): the round now, the stream's rounds,
 * what's planned - and the host's controls (pause, +5 min, a hint, end the round, the word queue, a break).
 */
export default function GameMonitor({ s }) {
    const { t } = useLaravelReactI18n();
    const [tab, setTab] = useState('now');
    const [m, setM] = useState(null);
    const [at, setAt] = useState(0);            // when m came (local ms): the clock runs on from there
    const [, tick] = useState(0);
    const [msg, setMsg] = useState(null);

    const load = useCallback(() => s.call('monitor').then((d) => { setM(d); setAt(Date.now()); }).catch(() => {}), [s.call]);
    useEffect(() => {
        load();
        const a = setInterval(load, 2500);
        const b = setInterval(() => tick((n) => n + 1), 500);
        return () => { clearInterval(a); clearInterval(b); };
    }, [load]);

    const control = (cmd, params = {}) =>
        s.call('control', { cmd, ...params })
            .then(() => { setMsg({ ok: true, text: t('guessword.mon_done') }); load(); return true; })
            .catch((e) => { setMsg({ ok: false, text: t(String(e.message) === '409' && cmd === 'queue_add' ? 'guessword.mon_word_bad' : 'guessword.mon_not_now') }); return false; })
            .finally(() => setTimeout(() => setMsg(null), 2500));

    if (!m?.current) return <p className="py-6 text-center text-sm text-ink-500">{t('guessword.mon_loading')}</p>;
    const c = m.current, plan = m.plan, past = m.past || [];
    const run = (Date.now() - at) / 1000;
    const live = c.phase === 'playing' && !c.paused;
    const left = live ? c.left - run : c.left;
    const tabs = [['now', '🔴 ' + t('guessword.mon_now')], ['past', t('guessword.mon_past'), past.length],
                  ['plan', t('guessword.mon_plan'), plan.queue.length + (plan.next ? 1 : 0)]];

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
                {m.active !== 'guess' && <span className="ml-auto whitespace-nowrap text-xs text-warning-700">{t('guessword.mon_inactive')}</span>}
            </div>

            <div className="p-4">
                {tab === 'now' && <Now c={c} left={left} run={run} control={control} t={t} />}
                {tab === 'past' && <Past past={past} t={t} />}
                {tab === 'plan' && <Plan plan={plan} round={c.round} control={control} t={t} />}
            </div>

            {msg && (
                <div className={'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg '
                    + (msg.ok ? 'bg-success-500' : 'bg-danger-500')}>{msg.text}</div>
            )}
        </div>
    );
}

function Now({ c, left, run, control, t }) {
    const best = c.top.find((g) => g.rank > 1) || c.top[0];
    const credits = c.people.reduce((n, p) => n + (p.credits || 0), 0);
    const playing = c.phase === 'playing';
    const hintBy = (b) => (b === 'auto' ? t('guessword.mon_by_auto') : b === 'host' ? t('guessword.mon_by_host') : b);
    return (
        <>
            <div className="flex flex-wrap gap-3">
                <Kpi label={t('guessword.mon_round', { n: c.round }) + (c.type === 'speed' ? ' · ⚡' : '')}
                     sub={(c.setter ? t('guessword.mon_setter', { name: c.setter }) : t('guessword.mon_setter_bot')) + ' · ' + t('guessword.opt_level_' + c.level)}>
                    <Secret word={c.word} big />
                </Kpi>
                <Kpi label={c.paused ? '⏸ ' + t('guessword.mon_paused') : t('guessword.mon_phase_' + c.phase)}
                     sub={playing ? t('guessword.mon_of', { d: clock(c.duration), e: clock(c.elapsed + (c.paused ? 0 : run)) }) : null}>
                    {playing ? clock(left) : c.phase === 'idle' || c.phase === 'finished' ? '—' : clock(c.phaseLeft)}
                </Kpi>
                <Kpi label={t('guessword.mon_closest')} sub={best ? best.name + ' · «' + best.word.toLowerCase() + '»' : null}>
                    {best ? <Rank r={best.rank} /> : '—'}
                </Kpi>
                <Kpi label={t('guessword.mon_players_words')} sub={t('guessword.mon_pace', { n: c.pace })}>{c.players} / {c.guesses}</Kpi>
                <Kpi label={t('guessword.mon_hints')} sub={t('guessword.mon_on_account', { n: credits })}>{c.hints.length}</Kpi>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                {c.paused
                    ? <button type="button" className={btn + ' !border-primary-500 !bg-primary-500 !text-white'} onClick={() => control('resume')}>▶ {t('guessword.mon_resume')}</button>
                    : <button type="button" className={btn} onClick={() => control('pause')}>⏸ {t('guessword.mon_pause')}</button>}
                <button type="button" className={btn} disabled={!playing} onClick={() => control('extend', { min: 5 })}>+5 {t('guessword.mon_min')}</button>
                <button type="button" className={btn} disabled={!playing || c.paused} onClick={() => control('hint')}>💡 {t('guessword.mon_hint_all')}</button>
                <button type="button" className={btn} disabled={!playing}
                        onClick={() => confirm(t('guessword.mon_skip_q')) && control('skip')}>⏭ {t('guessword.mon_skip')}</button>
                <button type="button" className={btn + ' text-danger-600'} disabled={!playing}
                        onClick={() => confirm(t('guessword.mon_finish_q')) && control('finish')}>⏹ {t('guessword.mon_finish')}</button>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
                <Box title={t('guessword.mon_top')}>
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead><tr><th className={th}>{t('guessword.mon_place')}</th><th className={th}>{t('guessword.mon_word')}</th>
                                <th className={th}>{t('guessword.mon_who')}</th><th className={th + ' text-right'}>{t('guessword.mon_when')}</th></tr></thead>
                            <tbody>
                                {c.top.map((g) => (
                                    <tr key={g.word}>
                                        <td className={td}><Rank r={g.rank} /></td>
                                        <td className={td + ' font-bold'}>{g.rank === 1 ? <Secret word={g.word} /> : g.word}</td>
                                        <td className={td}><span className="flex min-w-0 items-center gap-1.5"><Avatar v={g} size="h-5 w-5" /><span className="truncate">{g.name}</span><Links p={g} />
                                            {g.count > 1 && <span className="text-xs text-ink-500">+{g.count - 1}</span>}</span></td>
                                        <td className={td + ' text-right text-ink-500'}>{hhmm(g.t)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!c.top.length && <p className="py-3 text-sm text-ink-500">{t('guessword.mon_empty')}</p>}
                    </div>
                </Box>
                <div className="flex min-w-0 flex-col gap-3">
                    <Box title={t('guessword.mon_people')}>
                        <div className="max-h-80 overflow-auto">
                            <table className="w-full border-collapse">
                                <thead><tr><th className={th}>{t('guessword.mon_player')}</th><th className={th}>{t('guessword.mon_best')}</th>
                                    <th className={th + ' text-right'}>{t('guessword.mon_words')}</th><th className={th} /></tr></thead>
                                <tbody>
                                    {c.people.map((p) => (
                                        <tr key={p.id} className={p.dq ? 'opacity-50' : ''}>
                                            <td className={td}><span className="flex min-w-0 max-w-[15rem] items-center gap-1.5"><Avatar v={p} size="h-5 w-5" /><span className="truncate">{p.name}</span><Links p={p} /></span></td>
                                            <td className={td}><Rank r={p.best} /></td>
                                            <td className={td + ' text-right text-ink-500'}>{p.guesses}</td>
                                            <td className={td}>{p.credits ? '💡' + p.credits + ' ' : ''}{p.boost ? '⚡' : ''}{p.multi ? '✍️' : ''}{p.pending ? '⏳' : ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!c.people.length && <p className="py-3 text-sm text-ink-500">{t('guessword.mon_empty')}</p>}
                        </div>
                    </Box>
                    <Box title={t('guessword.mon_log')}>
                        <div className="max-h-64 overflow-auto">
                            {c.log.map((e, i) => (
                                <div key={i} className="border-t border-warm-100 py-1 text-sm first:border-t-0">
                                    <span className="mr-1.5 text-[11px] text-ink-500">{hms(e.t)}</span>
                                    {t('guessword.mon_ev_' + e.type, {
                                        name: e.name || '', gift: e.gift || '', count: e.count || 1, word: (e.word || '').toLowerCase(),
                                        by: hintBy(e.by) || '', rank: e.rank || '', cmd: e.cmd ? t('guessword.mon_cmd_' + e.cmd) : '',
                                    })}
                                </div>
                            ))}
                            {!c.log.length && <p className="text-sm text-ink-500">{t('guessword.mon_empty')}</p>}
                        </div>
                    </Box>
                </div>
            </div>
        </>
    );
}

function Past({ past, t }) {
    const [open, setOpen] = useState(null);
    const won = past.filter((r) => r.reason === 'exact');
    const stolen = won.filter((r) => r.stolen).length;
    const times = won.filter((r) => !r.stolen).map((r) => r.seconds);
    const fast = times.length ? Math.min(...times) : 0;
    const wins = {};
    won.forEach((r) => { if (r.winner) wins[r.winner] = (wins[r.winner] || 0) + 1; });
    const champ = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
    const first = past[past.length - 1];
    const how = (r) => (r.reason === 'exact' ? (r.stolen ? ['bg-warning-100 text-warning-800', '💰 ' + t('guessword.mon_r_stolen')] : ['bg-success-100 text-success-800', t('guessword.mon_r_won')])
        : r.reason === 'skip' ? ['bg-warm-100 text-ink-600', '⏭ ' + t('guessword.mon_r_skip')] : ['bg-danger-100 text-danger-700', '⌛ ' + t('guessword.mon_r_timeout')]);
    return (
        <>
            <div className="mb-3 flex flex-wrap gap-3">
                <Kpi label={t('guessword.mon_stream')} sub={first ? t('guessword.mon_since', { t: hhmm(first.at - first.seconds) }) : null}>{t('guessword.mon_rounds', { n: past.length })}</Kpi>
                <Kpi label={t('guessword.mon_won')} sub={t('guessword.mon_won_sub', { s: stolen, n: past.length - won.length })}>{won.length}</Kpi>
                <Kpi label={t('guessword.mon_avg')} sub={fast ? t('guessword.mon_fastest', { t: clock(fast) }) : null}>
                    {times.length ? clock(times.reduce((a, b) => a + b, 0) / times.length) : '—'}
                </Kpi>
                <Kpi label={t('guessword.mon_champ')} sub={champ ? t('guessword.mon_wins', { n: champ[1] }) : null}>{champ ? champ[0] : '—'}</Kpi>
            </div>
            <div className="overflow-x-auto rounded-xl border border-warm-200 bg-surface px-2 py-1">
                <table className="w-full border-collapse">
                    <thead><tr>{['#', 'mon_word', 'mon_setter_col', 'mon_result', 'mon_time', 'mon_players', 'mon_words', 'mon_start'].map((k) => (
                        <th key={k} className={th}>{k === '#' ? '#' : t('guessword.' + k)}</th>))}</tr></thead>
                    <tbody>
                        {past.map((r) => {
                            const [cls, label] = how(r);
                            return [
                                <tr key={r.round} className="cursor-pointer hover:bg-warm-50" onClick={() => setOpen(open === r.round ? null : r.round)}>
                                    <td className={td + ' text-ink-500'}>{r.round}</td>
                                    <td className={td + ' font-bold'}>{r.hidden ? <Secret word={(r.word || '').toUpperCase()} /> : (r.word || '').toUpperCase()}</td>
                                    <td className={td}>{r.setter || t('guessword.mon_bot')}</td>
                                    <td className={td}>{r.winner && <span className="mr-1.5 font-medium">{r.winner}</span>}
                                        <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + cls}>{label}</span></td>
                                    <td className={td}>{clock(r.seconds)}</td>
                                    <td className={td}>{r.players}</td>
                                    <td className={td}>{r.guesses}</td>
                                    <td className={td + ' text-ink-500'}>{hhmm(r.at - r.seconds)}</td>
                                </tr>,
                                open === r.round && (
                                    <tr key={r.round + 'x'}><td colSpan={8} className="bg-warm-50 px-2 py-2 text-sm">
                                        <div className="flex flex-wrap items-center gap-1"><b className="mr-1">{t('guessword.mon_top20')}:</b>
                                            {(r.top || []).map(([w, rk]) => <span key={w} className="rounded-md bg-surface px-1.5 py-0.5 text-xs">{rk} {w}</span>)}
                                            {!(r.top || []).length && <span className="text-ink-500">—</span>}</div>
                                        {!!(r.winner_words || []).length && (
                                            <div className="mt-1.5 flex flex-wrap items-center gap-1"><b className="mr-1">{t('guessword.mon_path')}:</b>
                                                {r.winner_words.map(([w, rk]) => <span key={w} className="rounded-md bg-surface px-1.5 py-0.5 text-xs">{w} {rk}</span>)}</div>
                                        )}
                                    </td></tr>
                                ),
                            ];
                        })}
                    </tbody>
                </table>
                {!past.length && <p className="py-4 text-center text-sm text-ink-500">{t('guessword.mon_no_rounds')}</p>}
            </div>
        </>
    );
}

function Plan({ plan, round, control, t }) {
    const [word, setWord] = useState('');
    const [first, setFirst] = useState(false);
    const add = () => { if (word.trim()) control('queue_add', { word: word.trim(), first }).then((ok) => ok && setWord('')); };
    const item = 'mb-2 flex items-center gap-2.5 rounded-xl border bg-surface px-3 py-2';
    const breaks = [[0, t('guessword.mon_break_none')], [round, t('guessword.mon_break_this')], [round + 1, t('guessword.mon_break_n', { n: 2 })], [round + 2, t('guessword.mon_break_n', { n: 3 })]];
    return (
        <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
            <Box title={t('guessword.mon_queue')}>
                {plan.queue.map((q, i) => (
                    <div key={q.id} className={item + (i === 0 ? ' border-primary-500' : ' border-warm-200')}>
                        <span className="w-8 font-bold text-ink-500">{round + 1 + i}</span>
                        <span className="min-w-0 flex-1">
                            <b className="mr-2"><Secret word={q.word} /></b>
                            <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + (q.host ? 'bg-primary-100 text-primary-800' : 'bg-warning-100 text-warning-800')}>
                                {q.host ? t('guessword.mon_q_host') : t('guessword.mon_q_viewer', { name: q.name })}</span>
                        </span>
                        <button type="button" className={btn + ' !h-8 !px-2'} disabled={i === 0} onClick={() => control('queue_move', { id: q.id, to: i - 1 })}>↑</button>
                        <button type="button" className={btn + ' !h-8 !px-2'} disabled={i === plan.queue.length - 1} onClick={() => control('queue_move', { id: q.id, to: i + 1 })}>↓</button>
                        <button type="button" className={btn + ' !h-8 !px-2'} onClick={() => confirm(t('guessword.mon_remove_q')) && control('queue_remove', { id: q.id })}>✕</button>
                    </div>
                ))}
                <div className={item + ' border-warm-200' + (plan.queue.length ? '' : ' border-primary-500')}>
                    <span className="w-8 font-bold text-ink-500">{round + 1 + plan.queue.length}</span>
                    <span className="min-w-0 flex-1">
                        🎲 {plan.next ? <b className="mr-2"><Secret word={plan.next.word} /></b> : <span className="text-ink-500">{t('guessword.mon_next_later')}</span>}
                        <span className="rounded-full bg-warm-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600">{t('guessword.mon_q_random')}</span>
                        {plan.next && <span className="ml-1 text-xs text-ink-500">{plan.next.ready ? t('guessword.mon_ready') : t('guessword.mon_preparing')}</span>}
                    </span>
                    <button type="button" className={btn + ' !h-8'} disabled={!plan.next} onClick={() => control('reroll')}>🔄 {t('guessword.mon_reroll')}</button>
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                    <input value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
                           placeholder={t('guessword.mon_add_ph')} className="h-9 min-w-0 flex-1 rounded-lg border-warm-300 bg-surface text-sm text-ink-900" />
                    <select value={first ? 1 : 0} onChange={(e) => setFirst(e.target.value === '1')} className="h-9 rounded-lg border-warm-300 bg-surface py-0 text-sm text-ink-900">
                        <option value={0}>{t('guessword.mon_add_last')}</option>
                        <option value={1}>{t('guessword.mon_add_first')}</option>
                    </select>
                    <button type="button" className={btn + ' !border-primary-500 !bg-primary-500 !text-white'} onClick={add}>{t('guessword.mon_add')}</button>
                </div>
                <p className="mt-2 text-xs text-ink-500">{t('guessword.mon_queue_note')}</p>
            </Box>
            <div className="flex min-w-0 flex-col gap-3">
                <Box title={t('guessword.mon_next_round')}>
                    <table className="w-full text-sm">
                        <tbody>
                            <tr><td className="py-1 text-ink-500">{t('guessword.opt_round_min')}</td><td className="py-1 text-right">{t('guessword.min', { n: Math.round(plan.roundSec / 60) })}</td></tr>
                            <tr><td className="py-1 text-ink-500">{t('guessword.opt_pause')}</td><td className="py-1 text-right">{t('guessword.sec', { n: plan.pause })}</td></tr>
                            <tr><td className="py-1 text-ink-500">{t('guessword.opt_level')}</td><td className="py-1 text-right">{t('guessword.opt_level_' + plan.level)}</td></tr>
                            <tr><td className="py-1 text-ink-500">{t('guessword.mon_lang')}</td><td className="py-1 text-right">{(plan.lang || '').toUpperCase()}</td></tr>
                        </tbody>
                    </table>
                    <div className="mt-2 text-sm text-ink-500">{t('guessword.mon_break')}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                        {breaks.map(([n, label]) => (
                            <button key={label} type="button" onClick={() => control('break_after', { round: n })}
                                    className={'rounded-md px-2.5 py-1 text-sm font-semibold ' + ((plan.breakAfter || 0) === n ? 'bg-primary-500 text-white' : 'bg-warm-100 text-ink-600')}>{label}</button>
                        ))}
                    </div>
                </Box>
                <Box title={t('guessword.mon_pending')}>
                    <div className="text-sm">💡 {t('guessword.mon_credits')}: {plan.credits.length
                        ? plan.credits.map(([n, k]) => n + ' ' + k).join(', ') : '—'}</div>
                    <div className="mt-1 text-sm">⚡ {t('guessword.mon_boosts')}: {plan.boosts.length ? plan.boosts.join(', ') : '—'}</div>
                </Box>
            </div>
        </div>
    );
}
