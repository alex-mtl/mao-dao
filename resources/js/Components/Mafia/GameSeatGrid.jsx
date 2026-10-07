import VideoSeat from '@/Components/Mafia/VideoSeat';

// Named-area diamond matching ttl10's video-grid layout — see the "Mafia
// Game UI Layout Alignment Plan" §2.1. Unlike ttl10's DOM-order-dependent
// auto-placement (fragile: depends on hiding a host box and a column-span
// toggle lining up), each seat is placed explicitly by its own slot number
// via `gridArea` in VideoSeat, so seat array order never has to match
// visual position:
//   [9][10][1][2]
//   [8][info   ][3]
//   [7][6][5][4]
const GRID_TEMPLATE_AREAS = '"s9 s10 s1 s2" "s8 info info s3" "s7 s6 s5 s4"';

/**
 * `localStream`/`remoteStreams` are both optional (plan Phase 7 — voice/
 * video is opt-in, and every other page using this grid, e.g. before
 * anyone's enabled their camera, simply never passes them). A seat with
 * no matching stream just falls back to the plain avatar tile it always
 * showed — there is no client-side visibility logic here at all, that's
 * handled entirely server-side by which producers the media-sfu sidecar
 * actually let this browser consume.
 *
 * `infoPanel` renders into the grid's own center cell (same physical slot
 * ttl10's `.game-panel` occupies).
 *
 * Rows are explicit `1fr` tracks (not `auto`), and the container is meant
 * to be given a real pixel/viewport height by its caller (not just however
 * tall its content happens to be) — this is what makes every seat AND the
 * info cell exactly the same height. Before this, rows were sized by
 * content: each `VideoSeat` capped its own height via `aspect-video`,
 * while the info cell had no such cap and grew to fit its own text,
 * leaving seats visibly shorter than the info cell in the same row —
 * reported directly by the user, along with the whole grid being far
 * smaller than it should be (padded into the same narrow, centered column
 * as the rest of the page instead of filling the available screen space).
 * `VideoSeat` no longer applies its own aspect ratio at all; every seat
 * simply fills whatever cell size this fixed row/column grid gives it.
 *
 * Every corner badge/icon/text size inside a seat (and the info panel)
 * comes from the `--seat-*`/`--info-*` custom properties set here, as
 * `clamp(min, <n>vw, max)` — matching ttl10's own approach of tying every
 * overlay's size to viewport width (so it scales with the grid itself)
 * rather than a fixed pixel value. Reported directly: fixed-size badges
 * looked "unbalanced" on a screen this size — a full-bleed game console,
 * not a page of body text — because they don't grow or shrink with the
 * seats around them on different screen sizes. Defined once here (not
 * duplicated per element) since these are CSS custom properties, which
 * inherit down to every descendant — `VideoSeat` and the `infoPanel`
 * content just reference `var(--seat-icon)` etc. directly.
 */
export default function GameSeatGrid({ seats, currentSpeakerSlot, localStream = null, remoteStreams = {}, infoPanel = null, className = '' }) {
    return (
        <div
            className={`grid h-full w-full grid-cols-4 grid-rows-3 gap-1 ${className}`}
            style={{
                gridTemplateAreas: GRID_TEMPLATE_AREAS,
                '--seat-icon': 'clamp(0.85rem, 2.2vw, 2rem)',
                // The big round avatar on every seat without live video
                // (the "?" on a free seat, initials or the player's photo
                // on a taken one): ~6x the area of the old small avatar at
                // a typical desktop width, scaled by vw.
                '--seat-avatar': 'clamp(2.6rem, 6.2vw, 7.5rem)',
                '--seat-icon-pad': 'clamp(2px, 0.5vw, 8px)',
                '--seat-badge-text': 'clamp(0.6rem, 1.8vw, 1.1rem)',
                '--seat-badge-pad-x': 'clamp(4px, 1.1vw, 10px)',
                '--seat-badge-pad-y': 'clamp(1px, 0.4vw, 4px)',
                '--seat-name-text': 'clamp(0.65rem, 2vw, 1.2rem)',
                '--seat-name-pad-x': 'clamp(4px, 1.3vw, 12px)',
                '--seat-name-pad-y': 'clamp(1px, 0.4vw, 4px)',
                // Reported as needing "at least 4x bigger" — meaning 4x
                // *surface area*, corrected after an initial pass wrongly
                // read that as 4x the linear size (font-size), which is
                // actually a 16x area increase (area scales with the
                // square of a linear dimension) and produced an icon that
                // nearly filled the whole seat. 4x *area* only needs a 2x
                // linear increase — every value below is exactly double
                // the pre-this-round figure (1.5rem/5.5vw/3.5rem). Also
                // must stay bounded *inside* its own seat at every width,
                // not just look right at one tested size — verified
                // directly: at a ~90px-wide mobile seat this clamps to its
                // 3rem (48px) floor, comfortably under half the seat's
                // width; at a ~310px desktop seat it clamps to its 7rem
                // (112px) ceiling, roughly a third of the seat's width —
                // neither end overflows the slotbox.
                '--seat-action-icon': 'clamp(3rem, 11vw, 7rem)',
                '--seat-status-text': 'clamp(0.7rem, 2vw, 1.15rem)',
                '--seat-status-pad-x': 'clamp(6px, 1.8vw, 14px)',
                '--seat-status-pad-y': 'clamp(2px, 0.7vw, 6px)',
                '--info-heading': 'clamp(1rem, 3vw, 2rem)',
                '--info-sub': 'clamp(0.7rem, 2vw, 1.15rem)',
                '--info-label': 'clamp(0.55rem, 1.6vw, 0.9rem)',
                '--info-menu-icon': 'clamp(1rem, 2.4vw, 1.5rem)',
                '--info-menu-pad': 'clamp(3px, 1vw, 10px)',
                // The per-speaker circular countdown ring (matching ttl10's
                // own `slot-timer`, a small corner badge at roughly 3vw —
                // see the plan doc's dedicated section). An explicit
                // diameter, not padding-derived, since the ring is drawn by
                // an SVG that needs a real box to size itself against.
                '--seat-timer-size': 'clamp(1.8rem, 5vw, 3.2rem)',
                // A fixed circle diameter for the info panel's nominee
                // badges — deliberately NOT padding-derived like the seat
                // corner badges above: those badges are each their own
                // absolutely-positioned element and hold a perfect circle
                // fine with just padding + aspect-square, but these sit
                // side-by-side in a shared flex-wrap row, where a single
                // digit ("5") and a double digit ("10") produced visibly
                // different, non-square boxes under the same technique
                // (confirmed directly by measuring both: "5" rendered
                // 9.9×13.6px, an oval, while "10" happened to land on
                // 14.4×14.4px by coincidence of its own wider content). An
                // explicit equal height/width sized to comfortably fit two
                // digits removes the ambiguity entirely, for any content.
                '--info-nominee-badge': 'calc(var(--seat-badge-text) * 2.2)',
            }}
        >
            {seats.map((seat) => (
                <VideoSeat
                    key={seat.id}
                    seat={seat}
                    isSpeaking={seat.slot === currentSpeakerSlot}
                    stream={seat.isYou ? localStream : (remoteStreams[seat.id] ?? null)}
                />
            ))}
            <div style={{ gridArea: 'info' }} className="flex h-full w-full items-stretch justify-stretch">
                {infoPanel}
            </div>
        </div>
    );
}
