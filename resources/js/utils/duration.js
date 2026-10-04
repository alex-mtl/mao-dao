/**
 * Formats a duration given in total minutes as "5 min", "30 min", "1h 05m",
 * "10h", or "10h 30m" — hours are never zero-padded, minutes are
 * zero-padded only when shown alongside hours. Returns null for a
 * missing/non-positive value so callers can decide how to render "no
 * estimate set".
 */
export function formatMinutes(totalMinutes) {
    if (totalMinutes === null || totalMinutes === undefined || totalMinutes <= 0) {
        return null;
    }

    const minutes = Math.round(totalMinutes);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours === 0) {
        return `${remainingMinutes} min`;
    }

    if (remainingMinutes === 0) {
        return `${hours}h`;
    }

    return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;
}

/**
 * Same formatting as formatMinutes(), but takes a duration in seconds
 * (e.g. an attempt's measured time_spent_seconds).
 */
export function formatSeconds(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined) {
        return null;
    }

    return formatMinutes(totalSeconds / 60);
}
