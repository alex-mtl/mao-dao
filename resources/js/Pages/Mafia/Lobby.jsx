import { useEffect, useRef, useState } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import RoomCode from '@/Components/Mafia/RoomCode';
import SeatGrid from '@/Components/Mafia/SeatGrid';
import useMafiaChannel from '@/hooks/useMafiaChannel';
import { Head, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function Lobby({ room, snapshot, isReady: initialIsReady, inviteUrl }) {
    const { t } = useLaravelReactI18n();
    const [state] = useMafiaChannel(room.code, snapshot);
    const [isReady, setIsReady] = useState(initialIsReady);

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

    const [togglingReady, setTogglingReady] = useState(false);
    const [leaving, setLeaving] = useState(false);

    const toggleReady = () => {
        setTogglingReady(true);
        router.post(
            route('mafia.ready', room.code),
            {},
            { onSuccess: () => setIsReady((prev) => !prev), onFinish: () => setTogglingReady(false) },
        );
    };
    const leaveRoom = () => {
        setLeaving(true);
        router.post(route('mafia.leave', room.code), {}, { onFinish: () => setLeaving(false) });
    };

    return (
        <AuthenticatedLayout>
            <Head title={t('mafia.lobby_title')} />

            <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
                <h1 className="text-center font-heading text-2xl font-bold text-ink-900">
                    {t('mafia.lobby_heading')}
                </h1>

                <RoomCode code={room.code} inviteUrl={inviteUrl} className="mx-auto mt-6 max-w-md" />

                <div className="mt-6">
                    <p className="text-sm font-semibold text-ink-700">
                        {t('mafia.seats_heading', { count: state.players.length, max: room.seats })}
                    </p>
                    <SeatGrid seats={room.seats} players={state.players} className="mt-2" />
                    <p className="mt-3 text-center text-sm text-ink-400">{t('mafia.waiting_for_ready')}</p>
                </div>

                <div className="mx-auto mt-8 flex max-w-md flex-col gap-3">
                    <PrimaryButton
                        className="w-full justify-center py-3 text-base"
                        onClick={toggleReady}
                        loading={togglingReady}
                        disabled={togglingReady || leaving}
                    >
                        {isReady ? t('mafia.not_ready_button') : t('mafia.ready_button')}
                    </PrimaryButton>
                    <SecondaryButton
                        className="w-full justify-center"
                        onClick={leaveRoom}
                        loading={leaving}
                        disabled={togglingReady || leaving}
                    >
                        {t('mafia.leave_button')}
                    </SecondaryButton>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
