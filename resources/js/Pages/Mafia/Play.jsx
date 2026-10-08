import { useEffect, useState } from 'react';
import { ArrowsPointingInIcon, Bars3Icon } from '@heroicons/react/24/solid';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import Badge from '@/Components/Badge';
import Dropdown from '@/Components/Dropdown';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import GameSeatGrid from '@/Components/Mafia/GameSeatGrid';
import SignalModal from '@/Components/Mafia/SignalModal';
import MediaSettingsModal from '@/Components/Mafia/MediaSettingsModal';
import useMafiaChannel from '@/hooks/useMafiaChannel';
import useMafiaMedia from '@/hooks/useMafiaMedia';
import useCountdown from '@/hooks/useCountdown';
import useFullscreenGame from '@/hooks/useFullscreenGame';
import useMirroredPreview from '@/hooks/useMirroredPreview';
import useSectionRoutes from '@/hooks/useSectionRoutes';
import { Head, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

const PHASE_LABEL_KEYS = {
    sitdown: 'phase_sitdown',
    don_watch: 'phase_don_watch',
    sheriff_watch: 'phase_sheriff_watch',
    day: 'phase_day',
    night: 'phase_night',
    shooting: 'phase_shooting',
    don_check: 'phase_don_check',
    sheriff_check: 'phase_sheriff_check',
    game_over: 'phase_game_over',
};

const STAGE_LABEL_KEYS = {
    speaking: 'stage_speaking',
    voting: 'stage_voting',
    defense_speech: 'stage_defense_speech',
    lock_vote: 'stage_lock_vote',
    last_speech: 'stage_last_speech',
    morning_speech: 'stage_morning_speech',
};

// A "dummy" seat (an unfilled slot that still got dealt into the game —
// see plan §7) has no account, so `name` is null. Every place a player's
// name is shown falls back to their seat number instead of rendering
// blank.
const withLabel = (p) => (p ? { ...p, name: p.name ?? `#${p.slot}` } : p);

export default function Play({ code, snapshot }) {
    const { t } = useLaravelReactI18n();
    const [state, , dismissSignal] = useMafiaChannel(code, snapshot, snapshot.you.id);
    const [busy, setBusy] = useState(false);
    const [signalTarget, setSignalTarget] = useState(null);
    const [justSentSignal, setJustSentSignal] = useState(false);
    const [isFullscreen, toggleFullscreen] = useFullscreenGame();
    const [mirrored, toggleMirrored] = useMirroredPreview();
    const [mediaSettingsOpen, setMediaSettingsOpen] = useState(false);
    const [remoteVolumes, setRemoteVolumes] = useState({});
    const { quizRoute, mafiaRoute } = useSectionRoutes();
    const media = useMafiaMedia(code);

    // The red "shout-out" glow ends by itself when its window passes; a light
    // clock (only running while some seat is glowing) re-renders to switch
    // it off, since no server event fires at that moment.
    const [nowMs, setNowMs] = useState(() => Date.now());
    const anyShoutOpen = state.seats.some((s) => s.shoutEndsAt && new Date(s.shoutEndsAt).getTime() > nowMs);
    useEffect(() => {
        if (!anyShoutOpen) {
            return undefined;
        }
        const timer = setInterval(() => setNowMs(Date.now()), 400);

        return () => clearInterval(timer);
    }, [anyShoutOpen]);
    // A fresh shout-out arriving after a quiet period must not be judged
    // against a stale clock.
    useEffect(() => {
        setNowMs(Date.now());
    }, [state.seats]);

    const remainingMs = useCountdown(state.deadlineAt);
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    // The day's speaking-order turn gets ttl10's own circular per-seat
    // countdown (§16) instead of the plain text pill every other phase
    // uses — `speechDurationMs` is the server-provided total for the
    // *whole* turn (see MafiaController::roomSnapshot()), so the ring can
    // show what fraction of it is left; `remainingSeconds` above is
    // already the same server-authoritative deadline every other phase's
    // countdown already relies on, just rendered differently here. A last
    // word (after being voted out or killed) and a tie-break defense
    // speech are the same "one seat has the floor" shape, so they get the
    // same ring — the server already folds all three into
    // `currentSpeakerSlot`/`speechDurationMs` (MafiaController::roomSnapshot()).
    const isSpeakingTurn = ['speaking', 'last_speech', 'morning_speech', 'defense_speech'].includes(state.stage)
        && Boolean(state.currentSpeakerSlot);
    const speechTotalSeconds = state.speechDurationMs ? Math.round(state.speechDurationMs / 1000) : remainingSeconds;

    // Reported directly: every living player's camera should already be
    // on during the day phase, and a page reload shouldn't require
    // clicking "Enable Camera" again. Both requirements collapse into one
    // rule — auto-connect whenever this condition is newly true — since a
    // reload re-mounts this effect and immediately re-evaluates it against
    // whatever `state.status` the fresh page load already has. Guarded by
    // `media.error` so a permission denial doesn't retry (and re-prompt)
    // on every subsequent status change; the player can still retry
    // manually via the existing button.
    //
    // Once the game ends, EVERY player — including the eliminated ones,
    // who were never covered by the `isAlive` day-phase rule above — gets
    // forced onto camera too, matching MafiaRoom::canPlayerView()'s
    // game_over rule that lets the whole table see each other again so
    // the group can keep talking after the result is announced.
    useEffect(() => {
        const shouldAutoConnect = (state.status === 'day' && state.you.isAlive) || state.status === 'game_over';
        if (shouldAutoConnect && !media.enabled && !media.connecting && !media.error) {
            media.connect();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.status, state.you.isAlive]);

    const act = (routeName, data = {}) => {
        setBusy(true);
        // `preserveState` keeps this component mounted across the visit
        // (matching Race Mode's identical Play.jsx) — without it, local
        // state like `justSentSignal` below was silently wiped by every
        // action's own page visit, discovered directly: the sent-signal
        // pulse never rendered because the round trip reset it before the
        // next paint.
        router.post(route(routeName, code), data, { onFinish: () => setBusy(false), preserveScroll: true, preserveState: true });
    };

    const sendSignal = (data) => {
        setSignalTarget(null);
        setJustSentSignal(true);
        setTimeout(() => setJustSentSignal(false), 5000);
        act('mafia.signal', data);
    };

    const [applyingMediaSettings, setApplyingMediaSettings] = useState(false);
    const applyMediaSettings = async (devices) => {
        setApplyingMediaSettings(true);
        try {
            await media.switchDevices(devices);
            setMediaSettingsOpen(false);
        } finally {
            setApplyingMediaSettings(false);
        }
    };

    // Whatever role THIS viewer is currently allowed to see for each seat —
    // own role always, teammates' roles while mafia/don, everyone's role
    // once the game is over (each source is already gated server-side, see
    // MafiaController::roomSnapshot() — this just picks whichever single
    // one applies per seat for VideoSeat to render).
    const mafiaTeammateRoleBySlot = Object.fromEntries(state.mafiaTeammates.map((m) => [m.slot, m.role]));
    const seatsWithRoles = state.seats.map((seat) => ({
        ...seat,
        visibleRole: seat.isYou ? state.you.role : (seat.role ?? mafiaTeammateRoleBySlot[seat.slot] ?? null),
    }));

    // Nominate/vote/shoot/check are mutually exclusive by phase (plan
    // §2.5) — a seat gets at most one of these as its "primary action",
    // whole-seat tappable rather than a separate pick-list. Target
    // eligibility mirrors exactly what the removed PlayerPickList sections
    // used to gate on (`alivePlayers` = alive, not self; voting candidates
    // = whatever `state.votingCandidates` already lists) — no new
    // gameplay rule here, only where the control lives.
    const seatAction = (seat) => {
        const isEligibleTarget = seat.status === 'alive' && !seat.isYou;
        let action = null;

        if (state.canNominate && isEligibleTarget) {
            action = {
                type: 'nominate',
                onClick: () => act('mafia.nominate', { target_player_id: seat.id }),
                isCurrentPick: seat.id === state.you.currentNomineeId,
            };
        } else if (state.canVote && state.votingCandidates.some((c) => c.id === seat.id)) {
            action = { type: 'vote', onClick: () => act('mafia.vote', { candidate_player_id: seat.id }) };
        } else if (state.canShoot && isEligibleTarget) {
            action = { type: 'shoot', onClick: () => act('mafia.shoot', { target_player_id: seat.id }), disabled: state.hasActedThisStage };
        } else if (state.canDonCheck && isEligibleTarget) {
            action = { type: 'check', onClick: () => act('mafia.don-check', { target_player_id: seat.id }), disabled: state.hasActedThisStage };
        } else if (state.canSheriffCheck && isEligibleTarget) {
            action = { type: 'check', onClick: () => act('mafia.sheriff-check', { target_player_id: seat.id }), disabled: state.hasActedThisStage };
        }

        return action ? { ...action, disabled: busy || Boolean(action.disabled) } : null;
    };
    // Signal is available whenever `MafiaController::signal()` would accept
    // it (alive, target alive, not self — every status this page can even
    // render already satisfies the "not lobby/game_over/cancelled" part),
    // and — unlike the mutually-exclusive actions above — can coexist with
    // a seat's own `action` (e.g. nominate and signal are both live during
    // the speaking stage), which is why it's a separate small icon rather
    // than folded into `action` (plan §2.3).
    // Past check results (plan §2.4's optional row, Phase 7 polish) —
    // `donCheckHistory`/`sheriffCheckHistory` are already scoped
    // server-side to only ever be non-empty for the actual don/sheriff, so
    // no extra visibility logic is needed here beyond picking whichever
    // (at most one) history applies to a given seat.
    const donCheckBySlot = Object.fromEntries(state.donCheckHistory.map((c) => [c.slot, c.isSheriff]));
    const sheriffCheckBySlot = Object.fromEntries(state.sheriffCheckHistory.map((c) => [c.slot, c.isBlackTeam]));
    const checkBadgeForSlot = (slot) => {
        if (slot in donCheckBySlot) {
            return { type: 'don-check', positive: donCheckBySlot[slot] };
        }
        if (slot in sheriffCheckBySlot) {
            return { type: 'sheriff-check', positive: sheriffCheckBySlot[slot] };
        }
        return null;
    };

    const isGameOver = state.status === 'game_over';

    // Device controls (settings/mic/cam/mirror on your own seat, a
    // volume slider on everyone else's) — ttl10's own self mic/cam toggle
    // is lobby/post-game-only (during actual play, mic/cam is meant to
    // follow the game phase automatically, a separate mechanic this app
    // doesn't build yet), but device-source settings, the mirror
    // preference, and other players' volume are plain local display
    // choices with no such restriction, so they're available any time the
    // relevant stream exists.
    const mediaControlsForSeat = (seat) => {
        if (seat.isYou) {
            // Always present once seated: while there is no live connection
            // (denied, no device, reconnecting) the icons show as off and
            // pressing mic/cam/settings retries it — same as the lobby. It
            // also hosts the shout-out button, which must not depend on the
            // camera working.
            const live = media.enabled;
            const retry = () => {
                if (!media.connecting) {
                    media.connect();
                }
            };

            return {
                type: 'self',
                canToggleMicCam: isGameOver,
                micEnabled: live && media.micEnabled,
                camEnabled: live && media.camEnabled,
                mirrored,
                onToggleMic: live ? media.toggleMic : retry,
                onToggleCam: live ? media.toggleCam : retry,
                onToggleMirror: toggleMirrored,
                onOpenSettings: live ? () => setMediaSettingsOpen(true) : retry,
            };
        }

        return media.remoteStreams[seat.id]
            ? {
                type: 'volume',
                volume: remoteVolumes[seat.id] ?? 1,
                onVolumeChange: (value) => setRemoteVolumes((prev) => ({ ...prev, [seat.id]: value })),
            }
            : null;
    };

    const seatsWithOverlays = seatsWithRoles.map((seat) => ({
        ...seat,
        action: seatAction(seat),
        canSignal: state.you.isAlive && seat.status === 'alive' && !seat.isYou,
        onSignalClick: () => setSignalTarget({ id: seat.id, name: withLabel(seat).name }),
        pulse: seat.isYou ? (justSentSignal ? 'sent' : (state.receivedSignals.length > 0 ? 'received' : null)) : null,
        checkBadge: checkBadgeForSlot(seat.slot),
        mediaControls: mediaControlsForSeat(seat),
        isShouting: Boolean(seat.shoutEndsAt) && new Date(seat.shoutEndsAt).getTime() > nowMs,
        shoutOut: seat.isYou && state.you.isAlive && state.status === 'day'
            ? { canShout: state.canShoutOut && !busy, onClick: () => act('mafia.shout-out') }
            : null,
        speechTimer: isSpeakingTurn && seat.slot === state.currentSpeakerSlot
            ? { remainingSeconds, totalSeconds: speechTotalSeconds }
            : null,
    }));

    return (
        <AuthenticatedLayout hideChrome={isFullscreen} onEnterFullscreen={!isFullscreen ? toggleFullscreen : null}>
            <Head title={t('mafia.play_title')} />

            {/* The grid is the dominant element on this screen — full
                viewport width, and as much height as the (possibly
                hidden) site chrome leaves behind — rather than sharing
                the same narrow, padded column as the rest of the page's
                content below it. Reported directly: seats were far
                smaller than they should be, with unused space to their
                left/right/below, and fullscreen mode barely helped since
                only the header disappeared while the grid itself stayed
                the same (small) size.

                The "enter fullscreen" trigger now lives in the header
                itself (AuthenticatedLayout's `onEnterFullscreen`), not
                floating on the grid — the header should fully appear/
                disappear on click, not stay sticky with the grid
                scrolling underneath it. Once hidden, the way back
                (hamburger menu + exit-fullscreen) is anchored inside the
                info panel below, not floating over the video grid. */}
            <div className="relative w-full" style={{ height: isFullscreen ? '100vh' : 'calc(100vh - 3.5rem)' }}>
                {state.receivedSignals.length > 0 && (
                    <div className="absolute left-2 right-2 top-2 z-10 space-y-2" aria-live="polite">
                        {state.receivedSignals.map((s) => (
                            <div
                                key={s.id}
                                className="flex items-center justify-between gap-2 rounded-lg border border-accent-300 bg-accent-50 px-3 py-2 text-sm text-ink-800 shadow-elevated"
                            >
                                <span>
                                    {t('mafia.signal_received', {
                                        slot: s.fromSlot,
                                        details: [s.number, s.color ? t(`mafia.signal_color_${s.color}`) : null]
                                            .filter(Boolean)
                                            .join(' '),
                                    })}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => dismissSignal(s.id)}
                                    className="text-ink-400 hover:text-ink-700"
                                    aria-label={t('mafia.signal_dismiss')}
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <GameSeatGrid
                    seats={seatsWithOverlays}
                    currentSpeakerSlot={state.currentSpeakerSlot}
                    localStream={media.localStream}
                    remoteStreams={media.remoteStreams}
                    cameraOffIds={media.cameraOffIds}
                    localCameraOn={media.camEnabled}
                    showDeadVideos={isGameOver}
                    infoPanel={
                        <div
                            className="relative flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border border-warm-200 bg-surface p-2 text-center"
                            role="status"
                            aria-live="polite"
                        >
                            {isFullscreen && (
                                <div className="absolute left-1 top-1 flex items-center gap-[var(--info-menu-pad)]">
                                    <Dropdown>
                                        <Dropdown.Trigger>
                                            <button
                                                type="button"
                                                aria-label={t('nav.open_menu')}
                                                className="flex items-center justify-center rounded-lg p-[var(--info-menu-pad)] text-ink-500 transition hover:bg-warm-100 hover:text-ink-800"
                                            >
                                                <Bars3Icon className="h-[var(--info-menu-icon)] w-[var(--info-menu-icon)]" aria-hidden="true" />
                                            </button>
                                        </Dropdown.Trigger>
                                        <Dropdown.Content align="left">
                                            {/* Every link opens in a new tab — this menu only
                                                ever exists while a game is actively being
                                                played (fullscreen is Play.jsx-only), so
                                                navigating away in the SAME tab would silently
                                                pull the player out of their game. */}
                                            <Dropdown.Link href={quizRoute('dashboard')} target="_blank" rel="noopener noreferrer">
                                                {t('nav.dashboard')}
                                            </Dropdown.Link>
                                            <Dropdown.Link href={quizRoute('profile.edit')} target="_blank" rel="noopener noreferrer">
                                                {t('nav.profile')}
                                            </Dropdown.Link>
                                            <Dropdown.Link href={mafiaRoute('mafia.index')} target="_blank" rel="noopener noreferrer">
                                                {t('nav.mafia')}
                                            </Dropdown.Link>
                                        </Dropdown.Content>
                                    </Dropdown>

                                    <button
                                        type="button"
                                        onClick={toggleFullscreen}
                                        aria-label={t('mafia.fullscreen_exit_button')}
                                        className="flex items-center justify-center rounded-lg p-[var(--info-menu-pad)] text-ink-500 transition hover:bg-warm-100 hover:text-ink-800"
                                    >
                                        <ArrowsPointingInIcon className="h-[var(--info-menu-icon)] w-[var(--info-menu-icon)]" aria-hidden="true" />
                                    </button>
                                </div>
                            )}

                            {isGameOver ? (
                                // Reported directly: the game-over result used to
                                // navigate the player away to an entirely separate,
                                // grid-less page — the whole point of forcing every
                                // camera on and revealing every role (see the
                                // useEffect above and MafiaController::roomSnapshot())
                                // is so the table can keep talking face-to-face once
                                // the result lands, which only works if everyone
                                // STAYS on this same grid. The announcement itself
                                // renders right here in the info panel instead:
                                // winning team's name in caps, bold, and colored —
                                // mafia black, town/citizens red — per direct request.
                                <>
                                    <h1 className="font-heading text-[length:var(--info-heading)] font-bold leading-tight text-ink-900">
                                        {t('mafia.game_over_heading')}
                                    </h1>
                                    <p
                                        className={`text-[length:var(--info-heading)] font-extrabold uppercase leading-tight ${
                                            state.winnerTeam === 'black' ? 'text-ink-950' : 'text-danger-600'
                                        }`}
                                    >
                                        {t(state.winnerTeam === 'black' ? 'mafia.game_over_black' : 'mafia.game_over_red')}
                                    </p>
                                    <p className="text-[length:var(--info-sub)] text-ink-500">
                                        {t('mafia.play_your_role', { role: t(`mafia.role_${state.you.role}`) })}
                                    </p>
                                </>
                            ) : (
                                <>
                                    {state.day > 0 && (
                                        <p className="text-[length:var(--info-label)] font-semibold uppercase tracking-wide text-ink-500">
                                            {t('mafia.day_label', { day: state.day })}
                                        </p>
                                    )}
                                    <h1 className="font-heading text-[length:var(--info-heading)] font-bold leading-tight text-ink-900">
                                        {t(`mafia.${PHASE_LABEL_KEYS[state.status]}`)}
                                    </h1>
                                    {state.stage && STAGE_LABEL_KEYS[state.stage] && (
                                        <p className="text-[length:var(--info-sub)] text-ink-400">{t(`mafia.${STAGE_LABEL_KEYS[state.stage]}`)}</p>
                                    )}
                                    {/* Currently-accused seats, as bare numbers in a
                                        circle — reported directly: the old text line
                                        ("Currently accused: <names>") lived below the
                                        fold under the grid, redundant with the ring
                                        already drawn around a nominated seat itself.
                                        Moved into the info panel, right under the
                                        stage label, with no text at all — just the
                                        slot numbers, since the seat ring is already
                                        what tells you *why* they're listed here. */}
                                    {state.nominees.length > 0 && state.stage === 'speaking' && (
                                        <div className="flex flex-wrap items-center justify-center gap-1">
                                            {state.nominees.map((n) => (
                                                <span
                                                    key={n.id}
                                                    className="flex h-[var(--info-nominee-badge)] w-[var(--info-nominee-badge)] shrink-0 items-center justify-center rounded-full bg-warning-500 text-[length:var(--seat-badge-text)] font-bold leading-none text-white"
                                                >
                                                    {n.slot}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {/* The speaking-order turn's countdown is shown
                                        on the speaker's own seat instead (the
                                        circular ring, §16) — matching ttl10's own
                                        scope exactly (its plain-text countdown is
                                        only ever used for phases that don't have a
                                        single active seat, e.g. voting/night). */}
                                    {state.deadlineAt && !isSpeakingTurn && (
                                        <span
                                            className={`rounded-full px-[var(--seat-name-pad-x)] py-[var(--seat-name-pad-y)] text-[length:var(--info-sub)] font-medium ${
                                                remainingSeconds <= 3 ? 'bg-danger-100 text-danger-700' : 'bg-primary-100 text-primary-700'
                                            }`}
                                            aria-label={t('mafia.seconds_remaining', { seconds: Math.max(0, remainingSeconds) })}
                                        >
                                            {Math.max(0, remainingSeconds)}s
                                        </span>
                                    )}

                                    {/* Reported directly: this needs to live where
                                        it's actually visible (the always-on-screen
                                        info panel), not below the fold under the
                                        grid — a full-height grid section pushes
                                        everything else offscreen until scrolled. */}
                                    {state.canPass && (
                                        <button
                                            type="button"
                                            onClick={() => act('mafia.pass')}
                                            disabled={busy}
                                            className="mt-1 rounded-full bg-warm-200 px-[var(--seat-name-pad-x)] py-[var(--seat-name-pad-y)] text-[length:var(--info-sub)] font-semibold text-ink-700 transition hover:bg-warm-300 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {t('mafia.pass_button')}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    }
                    className="p-1"
                />
            </div>

            <div className="mx-auto max-w-2xl px-4 py-4 sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge color={state.you.team === 'black' ? 'danger' : 'primary'}>
                        {t('mafia.play_your_role', { role: t(`mafia.role_${state.you.role}`) })}
                    </Badge>
                    {!state.you.isAlive && !isGameOver && <Badge color="neutral">{t('mafia.you_are_dead_notice')}</Badge>}
                    {/* Reported directly: this manual button had no reason to
                        exist during actual gameplay — the auto-connect effect
                        above already turns the camera on for every living
                        player once day phase starts, so a redundant manual
                        toggle was just clutter. It's still needed once the
                        game ends, though: that's the one place a connection
                        can fail (or the player can choose to switch back off)
                        with no other way to retry, since VideoSeat's own
                        per-seat self-controls (mic/cam/mirror/settings) only
                        render once `media.enabled` is already true. */}
                    {isGameOver && (
                        <SecondaryButton
                            type="button"
                            onClick={media.enabled ? media.disconnect : media.connect}
                            disabled={media.connecting}
                            loading={media.connecting}
                        >
                            {media.enabled ? t('mafia.camera_disable_button') : t('mafia.camera_enable_button')}
                        </SecondaryButton>
                    )}
                </div>
                {media.error && (
                    <p className="mt-2 text-sm text-danger-600">{t(`mafia.media_error_${media.error}`)}</p>
                )}

                {state.disconnectedPlayers.length > 0 && (
                    <div className="mt-6 space-y-3">
                        {state.disconnectedPlayers.map((p) => {
                            const label = withLabel(p).name;

                            return (
                                <div key={p.id} className="rounded-lg border border-warning-200 bg-warning-50 p-3">
                                    <p className="text-sm font-medium text-ink-800">
                                        {t('mafia.disconnect_notice', { name: label })}
                                    </p>
                                    <div className="mt-2 flex gap-2">
                                        <SecondaryButton
                                            type="button"
                                            onClick={() => act('mafia.disconnect-vote', { target_player_id: p.id, choice: 'eliminate' })}
                                            disabled={busy}
                                            className={p.myVote === 'eliminate' ? 'ring-2 ring-danger-500' : ''}
                                        >
                                            {t('mafia.disconnect_eliminate_button')}
                                        </SecondaryButton>
                                        <SecondaryButton
                                            type="button"
                                            onClick={() => act('mafia.disconnect-vote', { target_player_id: p.id, choice: 'continue' })}
                                            disabled={busy}
                                            className={p.myVote === 'continue' ? 'ring-2 ring-success-500' : ''}
                                        >
                                            {t('mafia.disconnect_continue_button')}
                                        </SecondaryButton>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {state.mafiaTeammates.length > 0 && (
                    <p className="mt-4 text-sm text-ink-600">
                        {t('mafia.mafia_teammates_heading', { slots: state.mafiaTeammates.map((m) => m.slot).join(', ') })}
                    </p>
                )}

                {state.spotlightPlayer && (
                    <p className="mt-4 rounded-lg bg-warm-50 p-3 text-center text-sm font-medium text-ink-700">
                        {t(`mafia.spotlight_${state.stage}`, { name: withLabel(state.spotlightPlayer).name })}
                    </p>
                )}

                {state.canNominate && (
                    <p className="mt-4 text-sm text-ink-600">{t('mafia.nominate_seat_hint')}</p>
                )}

                {state.canVote && (
                    <p className="mt-4 text-sm text-ink-600">{t('mafia.vote_seat_hint')}</p>
                )}

                {state.canLockVote && (
                    <div className="mt-6 text-center">
                        <p className="text-sm text-ink-600">
                            {t('mafia.lock_vote_candidates_heading', {
                                names: state.lockVoteCandidates.map((n) => withLabel(n).name).join(', '),
                            })}
                        </p>
                        <PrimaryButton
                            className="mt-3 w-full justify-center"
                            onClick={() => act('mafia.lock-vote')}
                            disabled={busy || state.hasActedThisStage}
                        >
                            {t('mafia.lock_vote_button')}
                        </PrimaryButton>
                    </div>
                )}

                {state.canShoot && (
                    <div className="mt-6">
                        <h2 className="text-sm font-semibold text-ink-700">{t('mafia.shoot_heading')}</h2>
                        <p className="mt-1 text-xs text-ink-400">{t('mafia.shoot_seat_hint')}</p>
                        <SecondaryButton
                            className="mt-2 w-full justify-center"
                            onClick={() => act('mafia.shoot', {})}
                            disabled={busy}
                        >
                            {t('mafia.shoot_abstain_button')}
                        </SecondaryButton>
                    </div>
                )}

                {(state.canDonCheck || state.canSheriffCheck) && (
                    <div className="mt-6">
                        <h2 className="text-sm font-semibold text-ink-700">
                            {t(state.canDonCheck ? 'mafia.don_check_heading' : 'mafia.sheriff_check_heading')}
                        </h2>
                        <p className="mt-1 text-xs text-ink-400">{t('mafia.check_seat_hint')}</p>
                    </div>
                )}

                {state.donCheckHistory.length > 0 && (
                    <div className="mt-6">
                        <h2 className="text-sm font-semibold text-ink-700">{t('mafia.don_check_history_heading')}</h2>
                        <ul className="mt-2 space-y-1 text-sm text-ink-600">
                            {state.donCheckHistory.map((c) => (
                                <li key={c.slot}>
                                    {t(c.isSheriff ? 'mafia.check_result_is_sheriff' : 'mafia.check_result_not_sheriff', { slot: c.slot })}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {state.sheriffCheckHistory.length > 0 && (
                    <div className="mt-6">
                        <h2 className="text-sm font-semibold text-ink-700">{t('mafia.sheriff_check_history_heading')}</h2>
                        <ul className="mt-2 space-y-1 text-sm text-ink-600">
                            {state.sheriffCheckHistory.map((c) => (
                                <li key={c.slot}>
                                    {t(c.isBlackTeam ? 'mafia.check_result_black' : 'mafia.check_result_red', { slot: c.slot })}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

            </div>

            {/* Covert-signal modal — opened via a seat's own small trigger
                icon (VideoSeat.jsx) rather than a standalone section with
                a target dropdown (plan §2.3). Only rendered while a target
                is set (not kept mounted with a toggled `show`) — see
                SignalModal's own docblock for why: Headless UI 2.2.10 gets
                stuck open otherwise. */}
            {signalTarget && (
                <SignalModal
                    target={signalTarget}
                    onSend={sendSignal}
                    onClose={() => setSignalTarget(null)}
                    disabled={busy}
                />
            )}

            {/* Device-source picker — opened from the local player's own
                seat (VideoSeat.jsx's settings icon). Same mount/unmount
                pattern as SignalModal, for the same Headless UI reason. */}
            {mediaSettingsOpen && (
                <MediaSettingsModal
                    onApply={applyMediaSettings}
                    onClose={() => setMediaSettingsOpen(false)}
                    applying={applyingMediaSettings}
                />
            )}
        </AuthenticatedLayout>
    );
}
