<?php

namespace App\Services\Mafia;

use App\Events\Mafia\MafiaRoomCancelled;
use App\Models\MafiaRoom;

/**
 * The authoritative timing engine for Mafia, directly analogous to
 * RaceTickService — Reverb only pushes to clients, it has no scheduling
 * capability of its own, so something has to actively decide "time's up"
 * for every phase deadline. The actual phase-by-phase rules live in
 * MafiaGameEngine; this class is just the thin "find rooms whose deadline
 * has passed" loop wrapper, called every ~500ms by `php artisan
 * mafia:tick`.
 */
class MafiaTickService
{
    public function __construct(private readonly MafiaGameEngine $engine)
    {
    }

    public function tick(): void
    {
        $this->cancelAbandonedLobbies();
        $this->engine->flagDisconnectedPlayers();
        $this->engine->resolveDisconnectVotes();
        $this->advanceDueRooms();
    }

    private function advanceDueRooms(): void
    {
        MafiaRoom::whereNotIn('status', ['lobby', 'game_over', 'cancelled'])
            ->whereNotNull('phase_deadline_at')
            ->where('phase_deadline_at', '<=', now())
            ->get()
            ->each(fn (MafiaRoom $room) => $this->engine->advance($room));
    }

    /**
     * A lobby whose game-host has gone silent before the match started
     * (tab closed, no explicit leave) — cancelled rather than left
     * orphaned. Mirrors RaceTickService::cancelAbandonedLobbies() exactly.
     */
    private function cancelAbandonedLobbies(): void
    {
        $staleBefore = now()->subSeconds(config('mafia.lobby_host_disconnect_timeout_seconds'));

        MafiaRoom::where('status', 'lobby')
            ->whereHas('players', fn ($query) => $query
                ->where('is_game_host', true)
                ->where('last_seen_at', '<', $staleBefore))
            ->each(function (MafiaRoom $room) {
                $room->update(['status' => 'cancelled']);
                MafiaRoomCancelled::dispatch($room);
            });
    }
}
