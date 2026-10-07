import { useEffect, useRef } from 'react';
import Avatar from '@/Components/Avatar';

/**
 * The "nobody here" mark for a free (or dummy) seat: a big filled circle
 * with a bold "?" that fills most of its height. The circle is ~6x the
 * area of the small initials avatar used for seated players (diameter
 * ~2.45x). Its size comes from `--seat-empty-mark` (a vw-based clamp set
 * by GameSeatGrid, like every other seat element) and is capped at 80% of
 * the seat so it still fits on a narrow phone seat. It is its own size container, so the glyph can be
 * sized in `cqh` (a share of the circle's own height) rather than in
 * fixed units — the "?" stays proportional at every seat size.
 */
function EmptySeatMark() {
    return (
        <span
            aria-hidden="true"
            className="flex aspect-square w-[min(var(--seat-empty-mark),80%)] items-center justify-center rounded-full bg-primary-100 text-primary-700 ring-2 ring-surface [container-type:size]"
        >
            <span className="font-heading font-extrabold leading-none text-[length:112cqh]">?</span>
        </span>
    );
}

/**
 * Renders a live stream if one is available for this seat, falling back
 * to the same avatar-tile look the rest of the app uses when it isn't
 * (no camera enabled, or the current phase doesn't authorize seeing this
 * player — see MafiaRoom::canPlayerView()). `muted` should be true only
 * for the local player's own tile, to avoid hearing yourself echo.
 *
 * `mirrored` (own tile only — matches ttl10's own `self-view-mirror-mode`
 * preference) flips the preview left-right purely visually; it never
 * affects the actual outgoing track, so it has no bearing on what remote
 * viewers see. `volume` (remote tiles only) sets the `<video>` element's
 * own native volume directly — a per-viewer, local-only adjustment, never
 * sent anywhere.
 */
export default function VideoTile({ stream, name, muted = false, mirrored = false, volume = 1, className = '' }) {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.srcObject = stream ?? null;
        }
    }, [stream]);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = volume;
        }
    }, [volume]);

    if (!stream) {
        return (
            <div className={`flex items-center justify-center ${className}`}>
                {name ? <Avatar name={name} size="sm" /> : <EmptySeatMark />}
            </div>
        );
    }

    return (
        <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={muted}
            style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
            className={`h-full w-full rounded-md object-cover ${className}`}
        />
    );
}
