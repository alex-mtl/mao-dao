import { useEffect, useState } from 'react';

function msUntil(iso) {
    if (!iso) return 0;
    return new Date(iso).getTime() - Date.now();
}

/**
 * Renders a countdown to an absolute server-given timestamp — never a
 * client-side timer that decides on its own when time is up. The server
 * (race:tick) is what actually enforces deadlines; this is display only.
 */
export default function useCountdown(targetIso) {
    const [remainingMs, setRemainingMs] = useState(() => msUntil(targetIso));

    useEffect(() => {
        if (!targetIso) {
            setRemainingMs(0);
            return undefined;
        }

        setRemainingMs(msUntil(targetIso));
        const id = setInterval(() => setRemainingMs(msUntil(targetIso)), 200);

        return () => clearInterval(id);
    }, [targetIso]);

    return Math.max(0, remainingMs);
}
