import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useCallback, useEffect, useState } from 'react';

const clock = (s) => Math.floor(Math.max(0, s) / 60) + ':' + String(Math.max(0, Math.round(s)) % 60).padStart(2, '0');
const btn = 'flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-warm-300 bg-surface px-3 text-sm font-semibold text-ink-800 hover:bg-warm-50 disabled:opacity-40';

/**
 * The anagram's round now, above its settings, and the host's controls: pause / resume, end the round.
 */
export default function AnagramNow({ s }) {
    const { t } = useLaravelReactI18n();
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

    const control = (cmd) =>
        s.call('control', { game: 'anagram', cmd })
            .then(() => { setMsg({ ok: true, text: t('guessword.mon_done') }); load(); })
            .catch(() => setMsg({ ok: false, text: t('guessword.mon_not_now') }))
            .finally(() => setTimeout(() => setMsg(null), 2500));

    const c = m?.current;
    if (!c) return null;
    const run = c.paused ? 0 : (Date.now() - at) / 1000;
    const playing = c.phase === 'playing';
    const left = playing ? c.left - run : c.phaseLeft - run;

    return (
        <div className="border-b border-warm-200 px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-heading text-sm font-bold text-ink-900">
                    {t('guessword.mon_now')} · {t('guessword.mon_round', { n: c.round })}
                </span>
                <span className={'text-sm font-semibold ' + (c.paused ? 'text-warning-700' : 'text-ink-700')}>
                    {c.paused ? '⏸ ' + t('guessword.mon_paused') : t('guessword.mon_phase_' + c.phase)}
                    {(playing || ['countdown', 'bonus', 'winner', 'reveal'].includes(c.phase)) && ' ' + clock(left)}
                </span>
                <span className="text-xs text-ink-500">{t('guessword.an_found', { p: c.players, f: c.found, n: c.possible })}</span>
                <span className="flex-1" />
                {c.paused
                    ? <button type="button" className={btn + ' !border-primary-500 !bg-primary-500 !text-white'} onClick={() => control('resume')}>▶ {t('guessword.mon_resume')}</button>
                    : <button type="button" className={btn} onClick={() => control('pause')}>⏸ {t('guessword.mon_pause')}</button>}
                <button type="button" className={btn} disabled={!playing || c.paused}
                        onClick={() => confirm(t('guessword.mon_finish_q')) && control('finish')}>⏹ {t('guessword.mon_finish')}</button>
            </div>
            {m.active !== 'anagram' && <p className="mt-1 text-xs text-warning-700">{t('guessword.an_inactive')}</p>}
            {msg && (
                <div className={'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg '
                    + (msg.ok ? 'bg-success-500' : 'bg-danger-500')}>{msg.text}</div>
            )}
        </div>
    );
}
