import { useEffect, useRef } from 'react';
import Avatar from '@/Components/Avatar';

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
                <Avatar name={name} size="sm" />
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
