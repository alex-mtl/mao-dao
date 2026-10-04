import { useEffect, useState } from 'react';

const STORAGE_KEY = 'mafia-fullscreen-game';

/**
 * Backs the "Fullscreen" toggle (plan §2.7) — a per-device display
 * preference (not game state), so it's local-storage-backed rather than
 * synced through the server. Deliberately CSS-only (hiding this app's own
 * header), not the native Fullscreen API — no permission prompt, no
 * OS-level chrome changes, matching ttl10's own reasoning for hiding its
 * header on the game screen (a plain class toggle, not `requestFullscreen`
 * — see the plan's note on ttl10's actual, button-less mechanism).
 */
export default function useFullscreenGame() {
    const [isFullscreen, setIsFullscreen] = useState(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, String(isFullscreen));
        } catch {
            // Storage unavailable (private browsing, blocked site data) —
            // the toggle still works for the rest of this page view, it
            // just won't be remembered next visit.
        }
    }, [isFullscreen]);

    return [isFullscreen, () => setIsFullscreen((prev) => !prev)];
}
