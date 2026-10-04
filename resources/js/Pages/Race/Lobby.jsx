import { useEffect, useRef, useState } from 'react';
import RaceLayout from '@/Layouts/RaceLayout';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import RoomCode from '@/Components/Race/RoomCode';
import PlayerList from '@/Components/Race/PlayerList';
import useRaceChannel from '@/hooks/useRaceChannel';
import { Head, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function Lobby({ room, players: initialPlayers, isHost, inviteUrl }) {
    const { t } = useLaravelReactI18n();
    const [state] = useRaceChannel(room.code, { status: room.status, players: initialPlayers });

    // The host starting the race broadcasts `race.starting`, which this
    // page picks up as a status change — every player in the lobby (not
    // just the one who clicked Start) gets moved into gameplay together.
    // Guarded to fire only once: this page stays subscribed to the same
    // channel during the (async) navigation to /play, so without the
    // guard every later status change (question -> question_results ->
    // ...) would re-trigger router.visit and remount Play from scratch,
    // wiping out its own local answer state each time.
    const hasNavigatedToPlay = useRef(false);
    useEffect(() => {
        if (state.status !== 'lobby' && !hasNavigatedToPlay.current) {
            hasNavigatedToPlay.current = true;
            router.visit(route('race.play', room.code));
        }
    }, [state.status, room.code]);

    const [starting, setStarting] = useState(false);
    const [leaving, setLeaving] = useState(false);

    const startRace = () => {
        setStarting(true);
        router.post(route('race.start', room.code), {}, { onFinish: () => setStarting(false) });
    };
    const leaveRace = () => {
        setLeaving(true);
        router.post(route('race.leave', room.code), {}, { onFinish: () => setLeaving(false) });
    };

    return (
        <RaceLayout>
            <Head title={t('race.lobby_title')} />

            <p className="text-center text-sm font-medium text-ink-500">{room.quizTitle}</p>
            <h1 className="mt-1 text-center font-heading text-2xl font-bold text-ink-900">
                {t('race.lobby_heading')}
            </h1>

            <RoomCode code={room.code} inviteUrl={inviteUrl} className="mt-6" />

            <div className="mt-6">
                <p className="text-sm font-semibold text-ink-700">
                    {t('race.players_heading', { count: state.players.length, max: room.maxPlayers })}
                </p>
                <PlayerList players={state.players} className="mt-2" />
            </div>

            <div className="mt-8 flex flex-col gap-3">
                {isHost && (
                    <PrimaryButton
                        className="w-full justify-center py-3 text-base"
                        onClick={startRace}
                        loading={starting}
                        disabled={starting || leaving}
                    >
                        {t('race.start_button')}
                    </PrimaryButton>
                )}
                <SecondaryButton
                    className="w-full justify-center"
                    onClick={leaveRace}
                    loading={leaving}
                    disabled={starting || leaving}
                >
                    {t('race.leave_button')}
                </SecondaryButton>
            </div>
        </RaceLayout>
    );
}
