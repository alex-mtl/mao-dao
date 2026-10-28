import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useEffect, useState } from 'react';
import GiftPicker from './GiftPicker';
import ViewerPicker from './ViewerPicker';
import { Switch } from './SettingsPanel';

// toast / voice line ids of each mode (the engine's room_prefs.TOASTS); greet / balloon / plane are on every page
const TOASTS = {
    guess: ['leader', 'jump', 'so_close', 'top', 'streak', 'hint', 'gift', 'hint_wait', 'thanks', 'follow_needed',
            'found_pending', 'dq', 'winner', 'steal', 'boost', 'promo', 'time_up', 'round', 'break', 'custom_word', 'tg_word', 'tg_linked',
            'greet', 'balloon', 'plane'],
    battle: ['b_score', 'b_lead', 'b_sum', 'b_win', 'b_round', 'greet', 'balloon', 'plane'],
    streamer: ['greet', 'balloon', 'plane'],
};
// lines that are only said (no toast of their own) / only shown (never said)
const VOICE_ONLY = ['winner', 'round', 'break', 'balloon', 'plane', 'b_score', 'b_lead', 'b_sum', 'b_win', 'b_round'];
const SHOW_ONLY = ['gift', 'hint_wait', 'custom_word', 'tg_word', 'tg_linked', 'boost', 'promo'];
// gift actions of each mode (the engine's room_prefs.GIFT_ACTIONS)
const GIFT_ACTIONS = { guess: ['hint', 'multi', 'boost', 'steal', 'balloon', 'plane', 'bomber', 'snowball', 'cake'], battle: ['balloon', 'plane', 'bomber'],
                       streamer: ['balloon', 'plane', 'bomber', 'snowball', 'cake'] };

/** One row per toast: show on/off, voice on/off and its own speech rate; a master switch for every voice. */
export function ToastsTab({ s, mode }) {
    const { t } = useLaravelReactI18n();
    const schema = s.info?.toasts?.schema || { ids: {}, rates: [] };
    const voiceRate = s.draft.global?.voice_rate || 1.5;
    const cfg = (id) => s.draft.toasts?.[id] || {};
    const shown = (id) => cfg(id).show !== 0;
    const voiced = (id) => cfg(id).voice !== 0;
    const update = (id, patch) => s.set('toasts', id, { ...cfg(id), ...patch });
    const ids = TOASTS[mode];
    const withVoice = ids.filter((id) => !SHOW_ONLY.includes(id));
    const allOn = withVoice.every(voiced);

    return (
        <>
        <div className="grid gap-4 border-b border-warm-100 py-3 sm:grid-cols-2">
            {[["voice_volume", "vol_voice"], ["fx_volume", "vol_fx"]].map(([key, label]) => {
                const v = s.draft.global?.[key] ?? 100;
                return (
                    <label key={key} className="flex flex-col gap-1.5 text-sm font-medium text-ink-800">
                        <span className="flex justify-between">{t('guessword.' + label)}<span className="text-ink-500">{v}%</span></span>
                        <input type="range" min="0" max="100" step="10" value={v} className="accent-primary-500"
                               onChange={(e) => s.set('global', key, Number(e.target.value))} />
                    </label>
                );
            })}
        </div>
        <table className="w-full border-collapse">
            <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    <th className="py-2">{t('guessword.col_toast')}</th>
                    <th className="py-2">{t('guessword.col_show')}</th>
                    <th className="py-2">{t('guessword.col_anim')}</th>
                    <th className="py-2">
                        <span className="flex items-center gap-2">
                            {t('guessword.col_voice')}
                            <Switch on={allOn} title={t('guessword.all_voices')}
                                    onChange={(on) => withVoice.forEach((id) => update(id, { voice: on ? 1 : 0 }))} />
                        </span>
                    </th>
                </tr>
            </thead>
            <tbody>
                {ids.map((id) => {
                    const def = schema.ids[id] ?? null;                 // 1 = key phrase, null = the room's voice rate
                    const rate = cfg(id).rate || def || voiceRate;
                    const showOff = !VOICE_ONLY.includes(id) && !shown(id);
                    return (
                        <tr key={id} className="border-t border-warm-100">
                            <td className="w-[46%] py-2 pr-3 text-sm font-medium text-ink-900">{t('guessword.toast_' + id)}</td>
                            <td className="py-2 pr-3">
                                {VOICE_ONLY.includes(id) ? <span className="text-ink-400">—</span>
                                    : <Switch on={shown(id)} onChange={(on) => update(id, { show: on ? 1 : 0 })} />}
                            </td>
                            <td className={'py-2 pr-3 ' + (showOff ? 'pointer-events-none opacity-40' : '')}>
                                {VOICE_ONLY.includes(id) ? <span className="text-ink-400">—</span> : (
                                    <select
                                        className="h-8 w-24 rounded-lg border-warm-300 bg-surface py-0 text-sm text-ink-900"
                                        value={cfg(id).anim ?? 'auto'}
                                        onChange={(e) => update(id, { anim: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}
                                    >
                                        <option value="auto">{t('guessword.anim_auto')}</option>
                                        {(schema.anims || []).filter((a) => a !== 'auto').map((a) => <option key={a} value={a}>{a} s</option>)}
                                    </select>
                                )}
                            </td>
                            <td className={'py-2 ' + (showOff ? 'pointer-events-none opacity-40' : '')}>
                                {SHOW_ONLY.includes(id) ? <span className="text-ink-400">—</span> : (
                                    <span className="flex items-center gap-2">
                                        <Switch on={voiced(id)} onChange={(on) => update(id, { voice: on ? 1 : 0 })} />
                                        <select
                                            className={'h-8 w-20 rounded-lg border-warm-300 bg-surface py-0 text-sm text-ink-900 ' + (voiced(id) ? '' : 'opacity-40')}
                                            value={rate}
                                            disabled={!voiced(id)}
                                            onChange={(e) => update(id, { rate: Number(e.target.value) })}
                                        >
                                            {[...new Set([...schema.rates, rate])].sort((a, b) => a - b).map((r) => (
                                                <option key={r} value={r}>{r}×</option>
                                            ))}
                                        </select>
                                    </span>
                                )}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
        </>
    );
}

/** One row per action: which gift triggers it - none, any, any from N coins, or a gift seen on the streams. */
export function GiftsTab({ s, mode }) {
    const { t } = useLaravelReactI18n();
    const gifts = s.info?.gifts || { min: [], catalog: [] };
    const rule = (a) => s.draft.gifts?.[a] ?? '';
    // do an action for a viewer of the stream now, as if their gift came (e.g. it came while the rule was another)
    const [viewers, setViewers] = useState([]);
    const [who, setWho] = useState({});             // action -> the viewer picked for it
    const [done, setDone] = useState(null);         // {ok, text}: the last "Apply now"
    useEffect(() => {
        const load = () => s.call('viewers').then((d) => setViewers(d.viewers || [])).catch(() => {});
        load();
        const id = setInterval(load, 15000);
        return () => clearInterval(id);
    }, [s.call]);
    const act = (a) => {
        const v = who[a];
        s.call('action', { action: a, id: v.id })
            .then(() => setDone({ ok: true, text: t('guessword.act_now_done', { action: t('guessword.act_' + a), name: v.name }) }))
            .catch(() => setDone({ ok: false, text: t('guessword.act_now_failed') }))
            .finally(() => setTimeout(() => setDone(null), 4000));
    };

    return (
        <>
            <table className="w-full border-collapse">
                <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                        <th className="py-2">{t('guessword.col_action')}</th>
                        <th className="py-2">{t('guessword.col_gift')}</th>
                        <th className="py-2 pl-3" colSpan={2}>{t('guessword.col_now')}</th>
                    </tr>
                </thead>
                <tbody>
                    {GIFT_ACTIONS[mode].map((a) => (
                        <tr key={a} className="border-t border-warm-100">
                            <td className="w-[28%] py-2.5 pr-3 text-sm font-medium text-ink-900">{t('guessword.act_' + a)}</td>
                            <td className="py-2.5">
                                <GiftPicker value={rule(a)} onChange={(v) => s.set('gifts', a, v)}
                                            catalog={gifts.catalog} tiers={gifts.min} />
                            </td>
                            <td className="w-[24%] py-2.5 pl-3">
                                <ViewerPicker value={who[a]} onChange={(v) => setWho((w) => ({ ...w, [a]: v }))} viewers={viewers} />
                            </td>
                            <td className="py-2.5 pl-2">
                                <button type="button" disabled={!who[a]} onClick={() => act(a)}
                                        className="h-10 whitespace-nowrap rounded-lg bg-primary-500 px-3 text-sm font-semibold text-white disabled:opacity-40">
                                    {t('guessword.act_now')}
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="py-3 text-xs text-ink-500">{t('guessword.gift_any_note')} {t('guessword.act_now_note')}</p>
            {done && (
                <div className={'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg '
                    + (done.ok ? 'bg-success-500' : 'bg-danger-500')}>{done.text}</div>
            )}
        </>
    );
}
