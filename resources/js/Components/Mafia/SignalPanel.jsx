import { useState } from 'react';
import SecondaryButton from '@/Components/SecondaryButton';
import { useLaravelReactI18n } from 'laravel-react-i18n';

const COLOR_SWATCHES = {
    grey: '#9ca3af',
    black: '#1f2937',
    red: '#dc2626',
};

/**
 * A simplified stand-in for ttl10's 14-button covert-signal panel (10
 * numbers + 3 colors + send) — both the number and the color are
 * optional, matching plan §7 ("5 reveals" with no number is still a
 * legitimate message on its own).
 */
export default function SignalPanel({ targets, onSend, disabled = false, className = '' }) {
    const { t } = useLaravelReactI18n();
    const [targetId, setTargetId] = useState('');
    const [number, setNumber] = useState(null);
    const [color, setColor] = useState(null);

    const send = () => {
        if (!targetId) {
            return;
        }
        onSend({ target_player_id: targetId, number, color });
        setNumber(null);
        setColor(null);
    };

    return (
        <div className={`rounded-lg border border-warm-200 bg-surface p-3 ${className}`}>
            <label className="sr-only" htmlFor="signal-target">
                {t('mafia.signal_choose_target')}
            </label>
            <select
                id="signal-target"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full rounded-lg border-warm-300 text-sm text-ink-900"
            >
                <option value="">{t('mafia.signal_choose_target')}</option>
                {targets.map((p) => (
                    <option key={p.id} value={p.id}>
                        {p.name}
                    </option>
                ))}
            </select>

            <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t('mafia.signal_number_label')}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                        key={n}
                        type="button"
                        onClick={() => setNumber(number === n ? null : n)}
                        aria-pressed={number === n}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${
                            number === n ? 'border-primary-600 bg-primary-100 text-primary-700' : 'border-warm-300 text-ink-600'
                        }`}
                    >
                        {n}
                    </button>
                ))}
            </div>

            <div className="mt-2 flex gap-2" role="group" aria-label={t('mafia.signal_color_label')}>
                {Object.entries(COLOR_SWATCHES).map(([name, hex]) => (
                    <button
                        key={name}
                        type="button"
                        onClick={() => setColor(color === name ? null : name)}
                        aria-pressed={color === name}
                        aria-label={t(`mafia.signal_color_${name}`)}
                        className={`h-8 w-8 rounded-full border-2 ${color === name ? 'border-primary-600' : 'border-warm-300'}`}
                        style={{ backgroundColor: hex }}
                    />
                ))}
            </div>

            <SecondaryButton
                type="button"
                onClick={send}
                disabled={disabled || !targetId}
                className="mt-3 w-full justify-center"
            >
                {t('mafia.signal_send_button')}
            </SecondaryButton>
        </div>
    );
}
