import { useLaravelReactI18n } from 'laravel-react-i18n';
import { Switch } from './SettingsPanel';

// toast / voice line ids of each mode (the engine's room_prefs.TOASTS); greet / balloon / plane are on every page
const TOASTS = {
    guess: ['leader', 'jump', 'so_close', 'top', 'streak', 'hint', 'gift', 'hint_wait', 'thanks', 'follow_needed',
            'found_pending', 'dq', 'winner', 'time_up', 'round', 'break', 'custom_word', 'tg_word', 'tg_linked',
            'greet', 'balloon', 'plane'],
    battle: ['b_score', 'b_lead', 'b_sum', 'b_win', 'b_round', 'greet', 'balloon', 'plane'],
    streamer: ['greet', 'balloon', 'plane'],
};
// lines that are only said (no toast of their own) / only shown (never said)
const VOICE_ONLY = ['winner', 'round', 'break', 'balloon', 'plane', 'b_score', 'b_lead', 'b_sum', 'b_win', 'b_round'];
const SHOW_ONLY = ['gift', 'hint_wait', 'custom_word', 'tg_word', 'tg_linked'];
// gift actions of each mode (the engine's room_prefs.GIFT_ACTIONS)
const GIFT_ACTIONS = { guess: ['hint', 'multi', 'balloon', 'plane', 'bomber'], battle: ['balloon', 'plane', 'bomber'],
                       streamer: ['balloon', 'plane', 'bomber'] };

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
        <table className="w-full border-collapse">
            <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    <th className="py-2">{t('guessword.col_toast')}</th>
                    <th className="py-2">{t('guessword.col_show')}</th>
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
    );
}

/** One row per action: which gift triggers it - none, any, any from N coins, or a gift seen on the streams. */
export function GiftsTab({ s, mode }) {
    const { t } = useLaravelReactI18n();
    const gifts = s.info?.gifts || { min: [], catalog: [] };
    const rule = (a) => s.draft.gifts?.[a] ?? '';

    return (
        <>
            <table className="w-full border-collapse">
                <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                        <th className="py-2">{t('guessword.col_action')}</th>
                        <th className="py-2">{t('guessword.col_gift')}</th>
                    </tr>
                </thead>
                <tbody>
                    {GIFT_ACTIONS[mode].map((a) => (
                        <tr key={a} className="border-t border-warm-100">
                            <td className="w-[46%] py-2.5 pr-3 text-sm font-medium text-ink-900">{t('guessword.act_' + a)}</td>
                            <td className="py-2.5">
                                <select
                                    className="h-9 w-full max-w-xs rounded-lg border-warm-300 bg-surface py-0 text-sm text-ink-900"
                                    value={rule(a)}
                                    onChange={(e) => s.set('gifts', a, e.target.value)}
                                >
                                    <option value="">{t('guessword.gift_none')}</option>
                                    <option value="any">{t('guessword.gift_any')}</option>
                                    {gifts.min.map((n) => <option key={n} value={'min:' + n}>{t('guessword.gift_min', { n })}</option>)}
                                    <option disabled>──────────</option>
                                    {gifts.catalog.map((g) => (
                                        <option key={g.name} value={'gift:' + g.name}>
                                            {g.name}{g.coins ? ' · ' + t('guessword.gift_coins', { n: g.coins }) : ''}
                                        </option>
                                    ))}
                                </select>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="py-3 text-xs text-ink-500">{t('guessword.gift_any_note')}</p>
        </>
    );
}
