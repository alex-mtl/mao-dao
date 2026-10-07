import { useEffect, useRef, useState } from 'react';
import { initials } from '@/Components/Avatar';

/**
 * The big round avatar a seat shows while it has no live video. Same size
 * for all three cases — ~6x the area of the old small avatar, taken from
 * `--seat-avatar` (a vw-based clamp set by GameSeatGrid, like every other
 * seat element) and capped at 80% of the seat so it still fits a narrow
 * phone seat:
 *   - a free/dummy seat (no name): a bold "?" filling ~83% of the circle;
 *   - a player with a profile photo: the photo, cropped to the circle;
 *   - otherwise their initials.
 * The circle is its own size container, so glyphs are sized in `cqh` (a
 * share of the circle's own height) and stay proportional at any size.
 */
function SeatAvatar({ name, avatarUrl }) {
    const [photoFailed, setPhotoFailed] = useState(false);
    const circle = 'aspect-square w-[min(var(--seat-avatar),80%)] rounded-full ring-2 ring-surface';

    if (name && avatarUrl && !photoFailed) {
        return (
            <img
                src={avatarUrl}
                alt=""
                aria-hidden="true"
                onError={() => setPhotoFailed(true)}
                className={`${circle} object-cover`}
            />
        );
    }

    const text = name ? initials(name) : '?';
    const glyphSize = text.length > 1 ? 'text-[length:44cqh]' : 'text-[length:83cqh]';

    return (
        <span
            aria-hidden="true"
            className={`flex ${circle} items-center justify-center bg-primary-100 text-primary-700 [container-type:size]`}
        >
            <span className={`font-heading font-extrabold leading-none ${glyphSize}`}>{text}</span>
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
export default function VideoTile({ stream, name, avatarUrl = null, muted = false, mirrored = false, volume = 1, className = '' }) {
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
                <SeatAvatar name={name} avatarUrl={avatarUrl} />
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
