import useCountdown from '@/hooks/useCountdown';

export default function Timer({ deadlineAt, totalSeconds, className = '' }) {
    const remainingMs = useCountdown(deadlineAt);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const pct = totalSeconds
        ? Math.min(100, Math.max(0, (remainingMs / 1000 / totalSeconds) * 100))
        : 0;

    return (
        <div className={className} role="timer" aria-live="off">
            <div className="flex items-center justify-end text-sm font-semibold text-ink-600">
                <span>{remainingSeconds}s</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-warm-200">
                <div
                    className={`h-full rounded-full transition-all duration-200 ${
                        remainingSeconds <= 3 ? 'bg-danger-500' : 'bg-primary-500'
                    }`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}
