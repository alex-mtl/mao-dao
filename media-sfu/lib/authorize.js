/**
 * Every consume request is authorized by asking Laravel, not by this
 * sidecar deciding for itself — visibility rules (who can see whom
 * during sitdown/don_watch/day/night/...) are genuinely game logic, and
 * this service has no idea what a "role" or a "phase" even is. Keeping
 * that decision in one place (MafiaGameEngine's world) means the game
 * engine's tests already cover the exact same rules this enforces here;
 * duplicating them in Node would just be two places that could drift out
 * of sync with each other, or with a mid-game rule change client-side
 * hiding alone can't be trusted to catch.
 *
 * Short-lived cache so a burst of consume requests around a phase change
 * doesn't turn into a burst of HTTP calls to Laravel for the same
 * question — a viewer's authorized set only changes on a phase
 * transition, never faster than that.
 */
const CACHE_TTL_MS = 1500;
const cache = new Map();

function cacheKey(roomCode, viewerPlayerId, targetPlayerId) {
    return `${roomCode}:${viewerPlayerId}:${targetPlayerId}`;
}

async function canView(roomCode, viewerPlayerId, targetPlayerId) {
    const key = cacheKey(roomCode, viewerPlayerId, targetPlayerId);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }

    const base = (process.env.LARAVEL_BASE_URL || '').replace(/\/$/, '');
    const url = `${base}/internal/mafia/can-view?room=${encodeURIComponent(roomCode)}&viewer=${encodeURIComponent(viewerPlayerId)}&target=${encodeURIComponent(targetPlayerId)}`;

    let value = false;
    try {
        const response = await fetch(url, {
            headers: { 'X-Media-Sfu-Secret': process.env.SHARED_SECRET || '' },
            signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
            const body = await response.json();
            value = body.canView === true;
        } else {
            console.error(`can-view request failed: HTTP ${response.status}`);
        }
    } catch (error) {
        // Fails closed — a Laravel outage or timeout must never be
        // treated as "everyone can see everyone".
        console.error('can-view request errored:', error.message);
        value = false;
    }

    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
}

module.exports = { canView };
