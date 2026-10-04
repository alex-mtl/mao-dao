import { useEffect, useState } from 'react';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import Modal from '@/Components/Modal';
import SecondaryButton from '@/Components/SecondaryButton';
import PrimaryButton from '@/Components/PrimaryButton';
import { useLaravelReactI18n } from 'laravel-react-i18n';

const COLOR_SWATCHES = {
    grey: '#9ca3af',
    black: '#1f2937',
    red: '#dc2626',
};

/**
 * The covert-signal number/color picker (plan §2.3) — a centered modal
 * rather than ttl10's seat-anchored number-pad, deliberately, for a
 * bigger and easier-to-hit picker on mobile. The target seat is a plain
 * prop (whichever seat's small trigger icon was clicked in Play.jsx),
 * not inferred from DOM position the way ttl10 does it.
 *
 * The explanatory paragraph used to always show inline — removed per
 * direct feedback ("the user already understands what this is for") and
 * moved behind a small help icon (top-right) that toggles it instead, so
 * a player who already knows the mechanic isn't shown a wall of text
 * every time. The exact wording is expected to be revisited later; only
 * where it lives changed here, not what it says.
 *
 * Rendered by the caller only while `target` is set (`{signalTarget &&
 * <SignalModal .../>}`), not kept mounted with a toggled `show` prop —
 * confirmed directly that Headless UI 2.2.10's `Dialog` here gets stuck
 * with `data-headlessui-state="open"` permanently after the first close
 * (opens fine once, `show` correctly re-renders as `false` afterward —
 * verified via render logging — but the Dialog itself never visually
 * closes again). Unmounting instead of toggling sidesteps that bug
 * entirely; the tradeoff is no closing fade animation, which is a fair
 * trade for a modal that actually closes.
 */
export default function SignalModal({ target, onSend, onClose, disabled = false }) {
    const { t } = useLaravelReactI18n();
    const [number, setNumber] = useState(null);
    const [color, setColor] = useState(null);
    const [showHint, setShowHint] = useState(false);

    // Reset the picker every time a new target is opened, so a leftover
    // selection from a previous signal never carries over silently.
    useEffect(() => {
        setNumber(null);
        setColor(null);
        setShowHint(false);
    }, [target?.id]);

    const send = () => {
        onSend({ target_player_id: target.id, number, color });
    };

    return (
        <Modal show onClose={onClose} maxWidth="sm">
            <div className="p-6">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <h2 className="font-heading text-lg font-bold text-ink-900">
                            {t('mafia.signal_heading')}
                        </h2>
                        <p className="mt-1 text-sm text-ink-500">
                            {t('mafia.signal_target_label', { name: target.name })}
                        </p>
                    </div>

                    {/* Click-toggled, not hover-only — this modal is used
                        on touch devices too, which have no reliable hover
                        state. */}
                    <button
                        type="button"
                        onClick={() => setShowHint((prev) => !prev)}
                        aria-label={t('mafia.signal_help_label')}
                        aria-expanded={showHint}
                        className="shrink-0 rounded-full p-1 text-ink-400 transition hover:bg-warm-100 hover:text-ink-600"
                    >
                        <QuestionMarkCircleIcon className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>

                {showHint && (
                    <p className="mt-2 rounded-lg bg-warm-50 p-2 text-xs text-ink-500">
                        {t('mafia.signal_description')}
                    </p>
                )}

                <div
                    className="mt-4 grid grid-cols-5 justify-items-center gap-1.5"
                    role="group"
                    aria-label={t('mafia.signal_number_label')}
                >
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                        <button
                            key={n}
                            type="button"
                            onClick={() => setNumber(number === n ? null : n)}
                            aria-pressed={number === n}
                            className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
                                number === n ? 'border-primary-600 bg-primary-100 text-primary-700' : 'border-warm-300 text-ink-600'
                            }`}
                        >
                            {n}
                        </button>
                    ))}
                </div>

                <div className="mt-3 flex justify-center gap-2" role="group" aria-label={t('mafia.signal_color_label')}>
                    {Object.entries(COLOR_SWATCHES).map(([name, hex]) => (
                        <button
                            key={name}
                            type="button"
                            onClick={() => setColor(color === name ? null : name)}
                            aria-pressed={color === name}
                            aria-label={t(`mafia.signal_color_${name}`)}
                            className={`h-9 w-9 rounded-full border-2 ${color === name ? 'border-primary-600' : 'border-warm-300'}`}
                            style={{ backgroundColor: hex }}
                        />
                    ))}
                </div>

                <div className="mt-6 flex gap-2">
                    <SecondaryButton type="button" onClick={onClose} className="flex-1 justify-center">
                        {t('mafia.signal_cancel_button')}
                    </SecondaryButton>
                    <PrimaryButton type="button" onClick={send} disabled={disabled} className="flex-1 justify-center">
                        {t('mafia.signal_send_button')}
                    </PrimaryButton>
                </div>
            </div>
        </Modal>
    );
}
