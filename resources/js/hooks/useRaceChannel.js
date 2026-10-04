import { useCallback, useEffect, useState } from 'react';
import { router } from '@inertiajs/react';
import echo from '@/echo';

/**
 * Subscribes to the public `race.{code}` Reverb channel and folds each
 * push into local state. The channel is public (no broadcasting-auth
 * endpoint needed for anonymous guests) — see App\Events\Race\*.
 *
 * Also resyncs from the /state JSON endpoint whenever the tab becomes
 * visible again (the most common real disconnect: a phone screen
 * locking/backgrounding), so a missed event while away doesn't leave the
 * UI stuck — a deliberate, low-risk complement to the socket, not a
 * second real-time architecture.
 */
export default function useRaceChannel(code, initialState) {
    const [state, setState] = useState(initialState);

    const resync = useCallback(() => {
        fetch(route('race.state', code), { headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : null))
            .then((fresh) => fresh && setState((prev) => ({ ...prev, ...fresh })))
            .catch(() => {});
    }, [code]);

    useEffect(() => {
        const channel = echo.channel(`race.${code}`);

        channel.listen('.player.joined', (payload) => {
            setState((prev) => ({ ...prev, players: payload.players }));
        });

        channel.listen('.race.starting', (payload) => {
            setState((prev) => ({ ...prev, status: 'starting', goAt: payload.goAt }));
        });

        channel.listen('.question.started', (payload) => {
            setState((prev) => ({
                ...prev,
                status: 'question',
                questionIndex: payload.questionIndex,
                totalQuestions: payload.totalQuestions,
                question: payload.question,
                deadlineAt: payload.deadlineAt,
                hasAnswered: false,
                selectedAnswerId: null,
                correctAnswerId: null,
            }));
        });

        channel.listen('.question.ended', (payload) => {
            setState((prev) => ({
                ...prev,
                status: 'question_results',
                questionIndex: payload.questionIndex,
                correctAnswerId: payload.correctAnswerId,
                leaderboard: payload.leaderboard,
                revealUntil: payload.revealUntil,
            }));
        });

        channel.listen('.race.finished', (payload) => {
            setState((prev) => ({ ...prev, status: 'finished', leaderboard: payload.leaderboard }));
        });

        channel.listen('.race.play-again', (payload) => {
            setState((prev) => ({ ...prev, newRoomCode: payload.newRoomCode }));
        });

        channel.listen('.race.cancelled', () => {
            // Reuses the Join page's own "cancelled" state view (it already
            // renders this for a stale/expired link) rather than a
            // dashboard redirect, which would just bounce an anonymous
            // guest to /login.
            router.visit(route('race.show', code));
        });

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                resync();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        // A periodic heartbeat (piggybacking on the same /state fetch used
        // for resync) so a host who's just sitting in the lobby doesn't
        // get treated as silently disconnected — see
        // config/race.php's host_disconnect_timeout_seconds.
        const heartbeat = setInterval(resync, 12_000);

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            clearInterval(heartbeat);
            echo.leave(`race.${code}`);
        };
    }, [code, resync]);

    return [state, setState];
}
