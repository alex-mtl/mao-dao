import { useEffect, useState } from 'react';

const STORAGE_KEY = 'mafia-mirror-preview';

/**
 * Whether the LOCAL player's own video tile is flipped left-right — a
 * per-device display preference, exactly like ttl10's own
 * `self-view-mirror-mode` localStorage value, not game state (so it isn't
 * synced through the server or scoped to a single room). Defaults to
 * mirrored (ttl10's own default), matching the familiar "looking in a
 * mirror" framing most people expect from a webcam preview.
 */
export default function useMirroredPreview() {
    const [mirrored, setMirrored] = useState(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored === null ? true : stored === 'true';
        } catch {
            return true;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, String(mirrored));
        } catch {
            // Storage unavailable — the toggle still works for this page
            // view, it just won't be remembered next visit.
        }
    }, [mirrored]);

    return [mirrored, () => setMirrored((prev) => !prev)];
}
