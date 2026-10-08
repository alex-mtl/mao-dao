import { useCallback, useEffect, useState } from 'react';
import { router } from '@inertiajs/react';
import echo from '@/echo';

/**
 * Subscribes to the public `mafia.{code}` Reverb channel — directly
 * analogous to useRaceChannel, scoped to what most of the game
 * broadcasts (seat occupancy, phase/stage transitions, cancellation).
 * Nothing sensitive (a dealt role, a check result) ever travels on this
 * channel — see the "Mafia Extension" plan §5.1 and MafiaPhaseChanged's
 * docblock; the one exception is a covert signal (plan §7), which *is*
 * sensitive and genuinely needs prompt, targeted delivery rather than a
 * "go re-fetch" ping — that's the private per-player channel scaffolded
 * back in Phase 2, finally used here. Pass `mafiaPlayerId` (Play.jsx has
 * one, Lobby.jsx doesn't) to subscribe to it; received signals land in
 * `state.receivedSignals`, each with a `dismiss()`-able local id.
 */
export default function useMafiaChannel(code, initialState, mafiaPlayerId = null, { spectator = false } = {}) {
    const [state, setState] = useState({ receivedSignals: [], ...initialState });

    // Every action (nominate/vote/shoot/pass/...) redirects back into this
    // same page, which gives Inertia a fresh `initialState` prop object —
    // but `useState`'s initializer only runs once, so without this the
    // page would keep showing whatever it rendered at mount until the
    // next unrelated WebSocket push happened to trigger a resync (the
    // same staleness class as the locale/color-scheme sync gotchas in
    // CLAUDE.md). This re-applies the fresh server props every time.
    useEffect(() => {
        // Preserves receivedSignals across the sync — it's purely
        // client-side, ephemeral state that no server response ever
        // carries, so a naive full replace would silently drop any
        // signal received between one action and the next.
        setState((prev) => ({ ...initialState, receivedSignals: prev.receivedSignals }));
    }, [initialState]);

    const resync = useCallback(() => {
        // A spectator has no seat: the public watch endpoint, not the player's own.
        fetch(route(spectator ? 'mafia.watch.state' : 'mafia.state', code), { headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : null))
            .then((fresh) => fresh && setState((prev) => ({ ...prev, ...fresh })))
            .catch(() => {});
    }, [code, spectator]);

    useEffect(() => {
        const channel = echo.channel(`mafia.${code}`);

        channel.listen('.lobby.updated', (payload) => {
            setState((prev) => ({ ...prev, players: payload.players, spectators: payload.spectators ?? prev.spectators }));
        });

        channel.listen('.game.starting', (payload) => {
            setState((prev) => ({ ...prev, status: payload.status, goAt: payload.goAt }));
        });

        // Every day/night transition MafiaGameEngine makes broadcasts this
        // — it deliberately carries no hidden information (see
        // MafiaPhaseChanged's docblock), so the response is just "go
        // re-fetch your own state now" rather than something to render
        // directly. Updating status/stage/deadline from the push alone
        // still keeps the countdown timer snappy between the push
        // arriving and the resync's response landing.
        channel.listen('.phase.changed', (payload) => {
            setState((prev) => ({ ...prev, status: payload.status, stage: payload.stage, day: payload.day, deadlineAt: payload.deadlineAt }));
            resync();
        });

        // A player's connection_status flipped (mafia:tick flagged them
        // disconnected, or their next request un-flagged them) — resync
        // to refresh the seat grid and the disconnect-vote panel.
        channel.listen('.player.connection-changed', () => {
            resync();
        });

        // Reported directly: nominate/vote/lock-vote/shoot/checks/
        // disconnect-votes only used to become visible to everyone else
        // once the NEXT phase transition happened to broadcast, or the
        // heartbeat below happened to land — nowhere near instant. This
        // fires on every one of those (see MafiaActionRecorded's own
        // docblock — one shared dispatch point, MafiaController::recordAction())
        // and, like every other broadcast here, carries no payload to render
        // directly; it's purely a "something changed, go re-fetch" signal.
        channel.listen('.action.recorded', () => {
            resync();
        });

        channel.listen('.game.over', (payload) => {
            setState((prev) => ({ ...prev, status: 'game_over', winnerTeam: payload.winnerTeam }));
            resync();
        });

        channel.listen('.room.cancelled', () => {
            router.visit(route('mafia.show', code));
        });

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                resync();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        // Mirrors config('mafia.heartbeat_interval_seconds') — kept as a
        // plain literal here since Race Mode's identical hook does the
        // same (no JS-side config() helper exists in this app).
        const heartbeat = setInterval(resync, 12_000);

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            clearInterval(heartbeat);
            echo.leave(`mafia.${code}`);
        };
    }, [code, resync]);

    useEffect(() => {
        if (!mafiaPlayerId) {
            return undefined;
        }

        const privateChannelName = `mafia.${code}.player.${mafiaPlayerId}`;
        const channel = echo.private(privateChannelName);

        channel.listen('.signal.received', (payload) => {
            setState((prev) => ({
                ...prev,
                receivedSignals: [...prev.receivedSignals, { id: `${Date.now()}-${Math.random()}`, ...payload }],
            }));
        });

        return () => {
            echo.leave(privateChannelName);
        };
    }, [code, mafiaPlayerId]);

    const dismissSignal = useCallback((id) => {
        setState((prev) => ({ ...prev, receivedSignals: prev.receivedSignals.filter((s) => s.id !== id) }));
    }, []);

    return [state, setState, dismissSignal];
}
