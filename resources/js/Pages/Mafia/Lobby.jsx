import { useEffect, useRef, useState } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import GameSeatGrid from '@/Components/Mafia/GameSeatGrid';
import useMafiaChannel from '@/hooks/useMafiaChannel';
import { Head, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { CheckIcon, ClipboardDocumentIcon, ShareIcon } from '@heroicons/react/24/outline';

const BUTTON_BASE =
    'inline-flex items-center justify-center gap-1 rounded-lg px-[var(--seat-name-pad-x)] py-[var(--seat-name-pad-y)] text-[length:var(--info-sub)] font-semibold transition disabled:opacity-60';

export default function Lobby({ room, snapshot, myPlayerId, inviteUrl }) {
    const { t } = useLaravelReactI18n();
    const [state] = useMafiaChannel(room.code, snapshot);

    // The auto-start broadcasts `game.starting`, which every seated player
    // picks up as a status change — guarded to fire once, same reasoning
    // as Race Mode's Lobby.jsx (this page stays subscribed to the same
    // channel during the async navigation to /play).
    const hasNavigatedToPlay = useRef(false);
    useEffect(() => {
        if (state.status !== 'lobby' && !hasNavigatedToPlay.current) {
            hasNavigatedToPlay.current = true;
            router.visit(route('mafia.play', room.code));
        }
    }, [state.status, room.code]);

    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    const me = state.players.find((p) => p.id === myPlayerId);
    const isReady = !!me?.isReady;

    const post = (name, data = {}) => {
        setBusy(true);
        router.post(route(name, room.code), data, { preserveScroll: true, onFinish: () => setBusy(false) });
    };

    const sit = (slot) => post('mafia.seat', { slot });
    const toggleReady = () => post('mafia.ready');
    const leaveRoom = () => post('mafia.leave');

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard unavailable — non-fatal, the code itself is on screen.
        }
    };

    const share = () => {
        if (navigator.share) {
            navigator.share({ url: inviteUrl }).catch(() => {});
        } else {
            copyLink();
        }
    };

    const bySlot = new Map(state.players.map((p) => [p.slot, p]));
    const seats = Array.from({ length: room.seats }, (_, i) => i + 1).map((slot) => {
        const player = bySlot.get(slot);

        if (player) {
            return {
                id: player.id,
                slot,
                name: player.name,
                status: 'alive',
                isYou: player.id === myPlayerId,
                lobbyBadges: { host: player.isGameHost, ready: player.isReady },
            };
        }

        return {
            id: `empty-${slot}`,
            slot,
            name: null,
            status: 'alive',
            action: { type: 'sit', onClick: () => sit(slot), disabled: busy },
        };
    });

    return (
        <AuthenticatedLayout>
            <Head title={t('mafia.lobby_title')} />

            <div className="relative w-full" style={{ height: 'calc(100vh - 3.5rem)' }}>
                <GameSeatGrid
                    seats={seats}
                    currentSpeakerSlot={null}
                    infoPanel={
                        <div className="flex h-full w-full flex-col items-center justify-center gap-[var(--info-menu-pad)] overflow-y-auto rounded-lg border border-warm-200 bg-surface p-2 text-center">
                            <p className="text-[length:var(--info-label)] font-semibold uppercase tracking-wide text-ink-500">
                                {t('mafia.room_label')}
                            </p>
                            <p className="break-all font-heading text-[length:var(--info-heading)] font-bold leading-tight tracking-[0.15em] text-primary-700">
                                {room.code}
                            </p>

                            <div className="flex flex-wrap justify-center gap-1">
                                <button
                                    type="button"
                                    onClick={copyLink}
                                    className={`${BUTTON_BASE} border border-warm-300 bg-surface text-ink-700 hover:bg-warm-50`}
                                >
                                    {copied ? (
                                        <CheckIcon className="h-[1em] w-[1em] text-success-600" aria-hidden="true" />
                                    ) : (
                                        <ClipboardDocumentIcon className="h-[1em] w-[1em]" aria-hidden="true" />
                                    )}
                                    {copied ? t('mafia.link_copied') : t('mafia.copy_invite_link')}
                                </button>
                                {typeof navigator !== 'undefined' && !!navigator.share && (
                                    <button
                                        type="button"
                                        onClick={share}
                                        className={`${BUTTON_BASE} border border-warm-300 bg-surface text-ink-700 hover:bg-warm-50`}
                                    >
                                        <ShareIcon className="h-[1em] w-[1em]" aria-hidden="true" />
                                        {t('mafia.share')}
                                    </button>
                                )}
                            </div>

                            <p className="text-[length:var(--info-label)] text-ink-500">
                                {t('mafia.seats_heading', { count: state.players.length, max: room.seats })}
                            </p>
                            <p className="hidden text-[length:var(--info-label)] text-ink-400 [@media(min-height:760px)]:block">
                                {t('mafia.pick_a_seat_hint')}
                            </p>

                            <div className="flex w-full max-w-sm flex-wrap justify-center gap-1">
                                <button
                                    type="button"
                                    onClick={toggleReady}
                                    disabled={busy}
                                    className={`${BUTTON_BASE} flex-1 bg-primary-600 text-white hover:bg-primary-700`}
                                >
                                    {isReady ? t('mafia.not_ready_button') : t('mafia.ready_button')}
                                </button>
                                <button
                                    type="button"
                                    onClick={leaveRoom}
                                    disabled={busy}
                                    className={`${BUTTON_BASE} flex-1 border border-warm-300 bg-surface text-ink-700 hover:bg-warm-50`}
                                >
                                    {t('mafia.leave_button')}
                                </button>
                            </div>
                        </div>
                    }
                />
            </div>
        </AuthenticatedLayout>
    );
}
