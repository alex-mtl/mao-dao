import MaterialIcon from '@/Components/Mafia/MaterialIcon';

/**
 * Notifications that pop up inside the game zone (top centre of the table)
 * instead of living in a list below the grid: a covert signal you received,
 * a check result, "you were eliminated", a media error. Each item is
 * `{ id, kind, text, team?, onDismiss? }`; `kind` is 'signal' | 'check' |
 * 'info' | 'error'. `team` ('red' | 'black') draws the same white disc with
 * a red / black figure the seats use for a revealed side.
 *
 * Fonts are clamped against the viewport width (this sits outside the seat
 * grid, so the grid's own --info-* variables are not available here).
 */
const KIND_STYLES = {
    signal: 'border-accent-400',
    check: 'border-primary-400',
    info: 'border-warm-300',
    error: 'border-danger-400',
};

export default function GameToasts({ toasts }) {
    if (toasts.length === 0) {
        return null;
    }

    return (
        <div
            className="pointer-events-none absolute left-1/2 top-2 z-20 flex w-[min(92%,34rem)] -translate-x-1/2 flex-col items-stretch gap-2"
            aria-live="polite"
            style={{ fontSize: 'clamp(0.8rem, 1.7vw, 1.15rem)' }}
        >
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={`animate-in pointer-events-auto flex items-center gap-3 rounded-xl border-2 bg-surface px-4 py-2.5 font-medium text-ink-900 shadow-elevated ${KIND_STYLES[toast.kind] ?? KIND_STYLES.info}`}
                >
                    {toast.team && (
                        <span className="flex aspect-square h-[2.2em] shrink-0 items-center justify-center rounded-full bg-white">
                            <MaterialIcon
                                name="frame_person"
                                className={`text-[1.5em] ${toast.team === 'black' ? 'text-black' : 'text-[#e11d48]'}`}
                                style={{ fontVariationSettings: "'FILL' 1, 'wght' 700" }}
                            />
                        </span>
                    )}
                    <span className="min-w-0 flex-1">{toast.text}</span>
                    {toast.onDismiss && (
                        <button
                            type="button"
                            onClick={toast.onDismiss}
                            aria-label="×"
                            className="shrink-0 text-xl leading-none text-ink-400 hover:text-ink-700"
                        >
                            &times;
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
