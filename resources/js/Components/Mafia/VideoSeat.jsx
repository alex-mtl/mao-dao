import MaterialIcon from '@/Components/Mafia/MaterialIcon';
import SpeechTimerRing from '@/Components/Mafia/SpeechTimerRing';
import VideoTile from '@/Components/Mafia/VideoTile';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useRef, useState } from 'react';

// Role icon per ttl10 exactly (plan §2.4, corrected per direct request to
// use the same icon design rather than look-alike substitutes):
// citizen/mafia are both the `frame_person` Material Symbols ligature,
// distinguished only by tint (ttl10: red vs black — ours: red vs a muted
// dark tone, since pure black would be invisible against this app's own
// translucent dark badge background); sheriff and don are ttl10's own
// custom PNGs (sheriff-star.png / don-ring.png, copied verbatim — ttl10's
// own CSS comments show alternate Material Symbols ligatures were tried
// and rejected for these two specifically), not a font glyph at all.
const ROLE_ICON_TYPES = {
    citizen: 'material',
    sheriff: 'image',
    mafia: 'material',
    don: 'image',
};

const ROLE_MATERIAL_NAME = 'frame_person';

// `/mafia/` prefix, not a bare `/images/...` path — this component only
// ever renders under a `/mafia/*` route (Play.jsx), and the bare domain
// root proxies to an entirely different app (mao-dao's own Node service),
// not this Laravel app's public/ folder — confirmed directly as a 404 on
// production. `/mafia/` aliases to the same public/ directory `/quiz/`
// does (see CLAUDE.md's nginx notes), so this resolves correctly.
const ROLE_IMAGE_SRC = {
    sheriff: '/mafia/images/mafia/sheriff-star.png',
    don: '/mafia/images/mafia/don-ring.png',
};

const ROLE_COLORS = {
    citizen: 'text-danger-400',
    sheriff: '',
    mafia: 'text-ink-300',
    don: '',
};

// One shared "primary action" per seat — nominate/vote/shoot/check are
// mutually exclusive by phase (plan §2.5), so a seat only ever has one of
// these active at a time. Icons match ttl10's own action reticles exactly
// (`.slot-nominate`, `.slot-candidate`, `.video-target`, `.video-lock`).
const ACTION_MATERIAL_NAMES = {
    nominate: 'frame_person_mic',
    vote: 'crop_free',
    shoot: 'motion_sensor_active',
    check: 'visibility_lock',
};

const ACTION_RING_COLORS = {
    nominate: 'ring-success-400',
    vote: 'ring-warning-400',
    shoot: 'ring-danger-400',
    check: 'ring-secondary-400',
    sit: 'ring-primary-400',
};

const ACTION_ICON_COLORS = {
    nominate: 'text-success-300',
    vote: 'text-warning-300',
    shoot: 'text-danger-300',
    check: 'text-secondary-300',
};

// Past check results (plan §2.4's "optional" row, done in Phase 7) — only
// ever set for seats *you* personally checked as don/sheriff (the data is
// already scoped that way server-side), rendered in the same corner as
// the role icon since the two are practically mutually exclusive in
// practice. Matches ttl10's own `.video-lock[data-checked-role]` reveal
// icons exactly: a don-check confirming "is sheriff" reuses the same
// sheriff-star image the sheriff's own role badge uses (ttl10 doesn't
// have a separate icon for this); every other outcome is `frame_person`
// tinted per team, same as the role badges above.
const CHECK_BADGE_TYPES = {
    'don-check': { true: 'image', false: 'material' },
    'sheriff-check': { true: 'material', false: 'material' },
};

const CHECK_BADGE_IMAGE_SRC = {
    'don-check': { true: '/mafia/images/mafia/sheriff-star.png' },
};

const CHECK_BADGE_COLORS = {
    'don-check': { false: 'text-ink-200' },
    'sheriff-check': { true: 'text-ink-300', false: 'text-danger-400' },
};

const CHECK_BADGE_LABEL_KEYS = {
    'don-check': { true: 'check_result_is_sheriff', false: 'check_result_not_sheriff' },
    'sheriff-check': { true: 'check_result_black', false: 'check_result_red' },
};

/**
 * Bottom-left tag: the player's profile photo (if they have one) in a
 * circle 1.5x as tall as the nickname pill, then the pill — on one row,
 * centred on the same horizontal line. Sizes come from the grid's vw-based
 * `--seat-name-*` variables. A photo that fails to load is simply left out.
 */
function SeatNameTag({ name, avatarUrl }) {
    const [photoFailed, setPhotoFailed] = useState(false);
    const showPhoto = Boolean(avatarUrl) && !photoFailed;

    return (
        <div className="absolute bottom-1 left-1 flex max-w-[85%] items-center gap-[var(--seat-name-pad-y)]">
            {showPhoto && (
                <img
                    src={avatarUrl}
                    alt=""
                    aria-hidden="true"
                    onError={() => setPhotoFailed(true)}
                    className="h-[var(--seat-name-avatar)] w-[var(--seat-name-avatar)] shrink-0 rounded-full object-cover ring-2 ring-white/70"
                />
            )}
            <span className="min-w-0 truncate rounded-full bg-ink-900/60 px-[var(--seat-name-pad-x)] py-[var(--seat-name-pad-y)] text-[length:var(--seat-name-text)] font-medium leading-[1.5] text-white">
                {name}
            </span>
        </div>
    );
}

/**
 * One seat's rich video card — see "Mafia Game UI Layout Alignment Plan"
 * §2.2. Positioned into the diamond grid via `gridArea` (GameSeatGrid
 * assigns `s{slot}`), so seat order in the underlying `seats` array never
 * has to match visual position. Corner overlays are absolutely positioned
 * on top of the video/avatar background, not stacked below it.
 *
 * Every overlay's icon/text/padding size below reads a `--seat-*` CSS
 * custom property set by the parent `GameSeatGrid` (`clamp(min, Nvw,
 * max)`) rather than a fixed Tailwind pixel size — matching ttl10's own
 * vw-based scaling, so badges grow and shrink with the seats around them
 * instead of staying a fixed size regardless of how big or small the grid
 * itself is on a given screen.
 *
 * `seat.visibleRole` (computed in Play.jsx — see plan §2.4) is whatever
 * role THIS viewer is currently allowed to see for this seat; VideoSeat
 * never decides visibility itself, it only renders whatever it's handed.
 *
 * `seat.action` (plan §2.5), when present, makes the *entire* card a tap
 * target — `{ type: 'nominate'|'vote'|'shoot'|'check', onClick, disabled,
 * isCurrentPick }`. The action button is deliberately placed in the DOM
 * *before* the role/seat-number/nickname overlays (not after) so those
 * stay legible and un-obscured on top of it — the corner badges are
 * exempt from the tap target because of this stacking, not because of any
 * z-index trick, which is a fine tradeoff since they're small.
 *
 * `seat.canSignal`/`seat.onSignalClick` (plan §2.3) add a small, separate
 * bottom-right trigger that opens the covert-signal modal for this seat —
 * unlike `action`, this can be present *alongside* a whole-seat `action`
 * (nominate and signal are both available during the speaking stage), so
 * it's deliberately a small icon rather than another full-card overlay.
 * Uses ttl10's own `leak_add` ligature (two points exchanging a signal),
 * not an eye-based icon — an eye/eye-slash reads as "I don't want to see
 * this player," the opposite of what sending a signal means.
 *
 * `seat.pulse` ('sent' | 'received' | null) briefly rings the viewer's
 * *own* seat right after they send a signal, or when they receive one —
 * nobody else's card ever gets this, mirroring ttl10's sender/receiver-
 * only pulse icons.
 */
export default function VideoSeat({ seat, isSpeaking = false, stream = null, videoHidden = false, className = '' }) {
    const { t } = useLaravelReactI18n();
    const isDead = seat.status !== 'alive';
    const roleType = seat.visibleRole ? ROLE_ICON_TYPES[seat.visibleRole] : null;
    const checkBadge = !roleType && seat.checkBadge ? seat.checkBadge : null;
    const checkBadgeType = checkBadge ? CHECK_BADGE_TYPES[checkBadge.type][checkBadge.positive] : null;
    const action = seat.action;

    // Nominate happens on nearly every seat throughout the whole speaking
    // stage, unlike vote/shoot/check (fewer eligible seats, shorter
    // window) — a permanently-visible overlay on every seat during that
    // long stage was reported directly as covering up the one thing
    // players actually want to see by default (everyone's video). Only
    // nominate is hover/focus-revealed; vote/shoot/check stay visible the
    // whole time they're active, matching the earlier design.
    const isHoverOnlyAction = action?.type === 'nominate';

    // The viewer's own device panel (mic/cam/mirror/settings) is only shown
    // while the pointer is over their seat or the seat has focus, and hides
    // again when either goes away. Tapping the seat focuses it (tabIndex),
    // which is how touch screens reveal it. A mouse click would otherwise
    // leave focus parked on the pressed button and keep the panel open
    // after the pointer left, so presses made with a mouse drop focus
    // right away (touch/keyboard presses keep it, so the panel stays up
    // while you use it).
    const hasSelfControls = seat.mediaControls?.type === 'self';
    const pointerTypeRef = useRef('mouse');
    const pressSelfControl = (handler) => (e) => {
        if (pointerTypeRef.current === 'mouse') {
            e.currentTarget.blur();
        }
        handler();
    };

    return (
        <div
            style={{ gridArea: `s${seat.slot}` }}
            tabIndex={hasSelfControls ? 0 : undefined}
            className={`group relative h-full w-full overflow-hidden rounded-lg border bg-warm-900 transition ${
                hasSelfControls ? 'outline-none' : ''
            } ${
                isDead ? 'border-warm-200 opacity-60' : 'border-warm-200'
            } ${isSpeaking ? 'ring-2 ring-primary-500' : ''} ${seat.isYou ? 'ring-2 ring-accent-500' : ''} ${className}`}
        >
            <VideoTile
                stream={stream}
                name={seat.name}
                avatarUrl={seat.avatarUrl}
                videoHidden={videoHidden}
                muted={seat.isYou}
                mirrored={seat.isYou && seat.mediaControls?.type === 'self' ? seat.mediaControls.mirrored : false}
                volume={seat.mediaControls?.type === 'volume' ? seat.mediaControls.volume : 1}
                className="absolute inset-0 h-full w-full"
            />

            {action && (
                <button
                    type="button"
                    onClick={(e) => {
                        // Reported directly: after clicking, this overlay
                        // stayed stuck fully visible ("залипает... до
                        // какого-то другого события") instead of going back
                        // to hover-only and un-covering the video. The real
                        // cause: clicking a <button> leaves it focused, and
                        // `group-focus-within:opacity-100` below (there for
                        // keyboard users who tab to it, not mouse clickers)
                        // then keeps it visible until something ELSE happens
                        // to steal focus later — not actually related to
                        // `isCurrentPick` (fixed separately below). Blurring
                        // immediately on click drops it back to hover-only
                        // the instant the action is used, exactly like
                        // moving the mouse away without clicking already did.
                        e.currentTarget.blur();
                        action.onClick();
                    }}
                    disabled={action.disabled}
                    aria-label={t('mafia.seat_action_label', { action: t(`mafia.action_${action.type}`), slot: seat.slot })}
                    className={`absolute inset-0 flex items-center justify-center ring-inset transition ${
                        // A seat that's already the current pick used to
                        // stay permanently visible too (dropping out of
                        // hover-only mode entirely) — the persistent ring
                        // below (`isCurrentPick`) already marks "this is
                        // your current pick" on its own, so the icon itself
                        // never needs to override hover-only just because
                        // it's currently picked.
                        isHoverOnlyAction ? 'opacity-0 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100' : ''
                    } ${
                        action.disabled
                            ? 'cursor-not-allowed bg-ink-900/50 ring-2 ring-warm-400/40'
                            : `cursor-pointer ring-2 ${action.type === 'sit' ? 'hover:bg-white/15' : 'bg-ink-900/10 hover:bg-ink-900/30'} ${ACTION_RING_COLORS[action.type]}`
                    } ${action.isCurrentPick ? 'ring-4 ring-success-400' : ''}`}
                >
                    {/* "Sit here" has no icon on purpose: the empty seat's
                        question-mark avatar already says "free", and the
                        highlighted ring + hover fill make it tappable. */}
                    {action.type !== 'sit' && (
                        <MaterialIcon
                            name={ACTION_MATERIAL_NAMES[action.type]}
                            className={`text-[length:var(--seat-action-icon)] drop-shadow-lg ${action.disabled ? 'text-warm-300' : ACTION_ICON_COLORS[action.type]}`}
                            style={{ fontVariationSettings: "'FILL' 1, 'wght' 700" }}
                        />
                    )}
                </button>
            )}

            {roleType && (
                <span
                    className="absolute left-1 top-1 flex aspect-square items-center justify-center rounded-full bg-ink-900/60 p-[var(--seat-icon-pad)]"
                    title={t(`mafia.role_${seat.visibleRole}`)}
                >
                    {roleType === 'image' ? (
                        <img
                            src={ROLE_IMAGE_SRC[seat.visibleRole]}
                            alt=""
                            aria-hidden="true"
                            className="block h-[var(--seat-icon)] w-[var(--seat-icon)] object-contain"
                        />
                    ) : (
                        <MaterialIcon name={ROLE_MATERIAL_NAME} className={`text-[length:var(--seat-icon)] ${ROLE_COLORS[seat.visibleRole]}`} />
                    )}
                    <span className="sr-only">{t(`mafia.role_${seat.visibleRole}`)}</span>
                </span>
            )}

            {seat.lobbyBadges && !roleType && (seat.lobbyBadges.host || seat.lobbyBadges.ready) && (
                <div className="absolute left-1 top-1 flex flex-col items-start gap-[var(--seat-icon-pad)]">
                    {seat.lobbyBadges.host && (
                        <span className="rounded-full bg-primary-600 px-[var(--seat-badge-pad-x)] py-[var(--seat-badge-pad-y)] text-[length:var(--seat-badge-text)] font-semibold leading-none text-white">
                            {t('mafia.game_host_badge')}
                        </span>
                    )}
                    {seat.lobbyBadges.ready && (
                        <span className="rounded-full bg-success-600 px-[var(--seat-badge-pad-x)] py-[var(--seat-badge-pad-y)] text-[length:var(--seat-badge-text)] font-semibold leading-none text-white">
                            {t('mafia.ready_badge')}
                        </span>
                    )}
                </div>
            )}

            {checkBadge && (
                <span
                    className="absolute left-1 top-1 flex aspect-square items-center justify-center rounded-full bg-ink-900/60 p-[var(--seat-icon-pad)]"
                    title={t(`mafia.${CHECK_BADGE_LABEL_KEYS[checkBadge.type][checkBadge.positive]}`, { slot: seat.slot })}
                >
                    {checkBadgeType === 'image' ? (
                        <img
                            src={CHECK_BADGE_IMAGE_SRC[checkBadge.type][checkBadge.positive]}
                            alt=""
                            aria-hidden="true"
                            className="block h-[var(--seat-icon)] w-[var(--seat-icon)] object-contain"
                        />
                    ) : (
                        <MaterialIcon
                            name={ROLE_MATERIAL_NAME}
                            className={`text-[length:var(--seat-icon)] ${CHECK_BADGE_COLORS[checkBadge.type][checkBadge.positive]}`}
                        />
                    )}
                    <span className="sr-only">
                        {t(`mafia.${CHECK_BADGE_LABEL_KEYS[checkBadge.type][checkBadge.positive]}`, { slot: seat.slot })}
                    </span>
                </span>
            )}

            {/* The active speaker's countdown ring takes over this exact
                corner instead of sitting elsewhere on the card — reported
                directly as visually unbalanced down in the bottom-right
                stack, and the seat number isn't needed here at the same
                time anyway (everyone can already see who's speaking from
                the ring itself + the existing `isSpeaking` highlight). */}
            {seat.speechTimer ? (
                <div className="absolute right-1 top-1">
                    <SpeechTimerRing
                        remainingSeconds={seat.speechTimer.remainingSeconds}
                        totalSeconds={seat.speechTimer.totalSeconds}
                        label={t('mafia.seconds_remaining', { seconds: Math.max(0, seat.speechTimer.remainingSeconds) })}
                    />
                </div>
            ) : (
                <span className="absolute right-1 top-1 flex aspect-square items-center justify-center rounded-full bg-ink-900/60 px-[var(--seat-badge-pad-x)] py-[var(--seat-badge-pad-y)] text-[length:var(--seat-badge-text)] font-semibold leading-none text-white">
                    {seat.slot}
                </span>
            )}

            <SeatNameTag name={seat.name ?? t('mafia.empty_seat')} avatarUrl={seat.name ? seat.avatarUrl : null} />

            {/* Signal trigger + other-player volume slider (per-OTHER-seat)
                and the local player's own settings/mic/cam/mirror cluster
                (per-OWN-seat) are mutually exclusive by ownership, but
                share one wrapper so both stack from the same corner. */}
            {(seat.canSignal || seat.mediaControls) && (
                <div className="absolute bottom-1 right-1 flex flex-col items-end gap-1">
                    {seat.canSignal && (
                        <button
                            type="button"
                            onClick={seat.onSignalClick}
                            aria-label={t('mafia.signal_trigger_label', { slot: seat.slot })}
                            className="flex aspect-square items-center justify-center rounded-full bg-ink-900/60 p-[var(--seat-icon-pad)] text-accent-300 opacity-70 transition hover:opacity-100 hover:text-accent-200"
                        >
                            <MaterialIcon name="leak_add" className="text-[length:var(--seat-icon)]" />
                        </button>
                    )}

                    {seat.mediaControls?.type === 'volume' && (
                        <div className="flex items-center gap-1 rounded-full bg-ink-900/60 p-[var(--seat-icon-pad)] opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                            <MaterialIcon name="volume_up" className="text-[length:var(--seat-icon)] text-white" />
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={seat.mediaControls.volume}
                                onChange={(e) => seat.mediaControls.onVolumeChange(Number(e.target.value))}
                                aria-label={t('mafia.media_volume_label', { name: seat.name ?? t('mafia.empty_seat') })}
                                className="h-1 w-12 accent-accent-400"
                            />
                        </div>
                    )}

                    {/* Device controls for the local player's OWN seat —
                        settings (device source), mic, cam, mirror. Only
                        ever populated (by Play.jsx) once the local camera
                        is actually on; the mic/cam on-off pair within it is
                        further gated to lobby/post-game, matching ttl10's
                        own self-service gate (during actual gameplay, this
                        app doesn't yet auto-drive mic/cam per phase/action
                        — a separate mechanic it doesn't implement yet). */}
                    {seat.mediaControls?.type === 'self' && (
                        <div
                            onPointerDown={(e) => {
                                pointerTypeRef.current = e.pointerType;
                            }}
                            className="pointer-events-none flex items-center gap-[var(--seat-icon-pad)] rounded-full bg-ink-900/60 p-[var(--seat-icon-pad)] opacity-0 transition group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                        >
                            {seat.mediaControls.canToggleMicCam && (
                                <>
                                    <button
                                        type="button"
                                        onClick={pressSelfControl(seat.mediaControls.onToggleMic)}
                                        aria-label={t(seat.mediaControls.micEnabled ? 'mafia.media_mic_disable_button' : 'mafia.media_mic_enable_button')}
                                        aria-pressed={!seat.mediaControls.micEnabled}
                                        className={`transition ${seat.mediaControls.micEnabled ? 'text-white' : 'text-danger-400'}`}
                                    >
                                        <MaterialIcon name={seat.mediaControls.micEnabled ? 'mic' : 'mic_off'} className="text-[length:var(--seat-icon)]" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={pressSelfControl(seat.mediaControls.onToggleCam)}
                                        aria-label={t(seat.mediaControls.camEnabled ? 'mafia.media_cam_disable_button' : 'mafia.media_cam_enable_button')}
                                        aria-pressed={!seat.mediaControls.camEnabled}
                                        className={`transition ${seat.mediaControls.camEnabled ? 'text-white' : 'text-danger-400'}`}
                                    >
                                        <MaterialIcon name={seat.mediaControls.camEnabled ? 'videocam' : 'videocam_off'} className="text-[length:var(--seat-icon)]" />
                                    </button>
                                </>
                            )}
                            <button
                                type="button"
                                onClick={pressSelfControl(seat.mediaControls.onToggleMirror)}
                                aria-label={t('mafia.media_mirror_button')}
                                aria-pressed={seat.mediaControls.mirrored}
                                className={`transition ${seat.mediaControls.mirrored ? 'text-accent-300' : 'text-white'}`}
                            >
                                <MaterialIcon name="flip" className="text-[length:var(--seat-icon)]" />
                            </button>
                            <button
                                type="button"
                                onClick={pressSelfControl(seat.mediaControls.onOpenSettings)}
                                aria-label={t('mafia.media_settings_button')}
                                className="text-white transition hover:text-accent-300"
                            >
                                <MaterialIcon name="settings" className="text-[length:var(--seat-icon)]" />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {seat.pulse && (
                <div
                    className={`pointer-events-none absolute inset-0 flex items-start justify-end p-1 ring-4 ring-inset ${
                        seat.pulse === 'sent' ? 'ring-accent-400' : 'animate-pulse ring-accent-500'
                    }`}
                >
                    {seat.pulse === 'sent' && (
                        <MaterialIcon name="eye_tracking" className="text-[length:var(--seat-icon)] text-accent-300" />
                    )}
                </div>
            )}

            {isDead && (
                // `pointer-events-none` — this used to be harmless (nothing
                // else on a dead player's own card was ever clickable), but
                // once game_over forces every player's camera on (including
                // the eliminated ones), an eliminated player's OWN seat also
                // gets its device-control cluster (mic/cam/mirror/settings)
                // — without this, this full-card dimming layer, painted
                // after those buttons in the DOM, would silently swallow
                // every click on them.
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink-900/50">
                    <span className="rounded-full bg-danger-600 px-[var(--seat-status-pad-x)] py-[var(--seat-status-pad-y)] text-[length:var(--seat-status-text)] font-medium text-white">
                        {t(`mafia.status_${seat.status}`)}
                    </span>
                </div>
            )}
        </div>
    );
}
