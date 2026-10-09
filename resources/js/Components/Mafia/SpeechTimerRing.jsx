const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The active speaker's circular countdown — matches ttl10's own
 * `slot-timer` element (an SVG ring drawn with `stroke-dasharray`/
 * `stroke-dashoffset`, the seconds remaining printed in the center),
 * per direct request to reproduce that specific look rather than the
 * plain text-only countdown pill this app uses for every other phase
 * (voting/night/shooting/... keep the plain pill — see Play.jsx; only
 * the day's speaking-order turn gets this treatment, matching ttl10's
 * own scope exactly).
 *
 * `remainingSeconds`/`totalSeconds` come from `useCountdown(state.deadlineAt)`
 * and the server-provided `state.speechDurationMs` respectively — unlike
 * ttl10 (which counts down a client-only value with no server resync at
 * all), this app's countdown stays tied to the same server-authoritative
 * deadline every other phase already uses; only the *visual* is new.
 * Turns red under 5 seconds, exactly like ttl10's own two-stage
 * green→red (not a three-stage green→yellow→red).
 */
export default function SpeechTimerRing({ remainingSeconds, totalSeconds, label }) {
    const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, remainingSeconds / totalSeconds)) : 0;
    const offset = CIRCUMFERENCE * (1 - progress);
    const isLow = remainingSeconds < 5;

    return (
        <div role="timer" aria-label={label} className="relative h-[var(--seat-timer-size)] w-[var(--seat-timer-size)] rounded-full seat-chip bg-black/60">
            <svg viewBox="0 0 100 100" className="block h-full w-full -rotate-90">
                <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="10" />
                <circle
                    cx="50"
                    cy="50"
                    r={RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={offset}
                    // Tailwind's `stroke-*` utility isn't extended to this
                    // app's color palette (only `fill`/`none`/`current` by
                    // default) — coloring via `currentColor` + a `text-*`
                    // class (which Tailwind DOES generate for any palette
                    // color) avoids needing a tailwind.config.js change for
                    // this one element.
                    className={isLow ? 'text-danger-500' : 'text-success-500'}
                    style={{ transition: 'stroke-dashoffset 1s linear, color 0.3s' }}
                />
            </svg>
            <span
                className="absolute inset-0 flex items-center justify-center text-[length:var(--seat-badge-text)] font-bold leading-none text-white"
                style={{ textShadow: '0 0 3px rgba(0,0,0,0.9)' }}
            >
                {Math.max(0, remainingSeconds)}
            </span>
        </div>
    );
}
