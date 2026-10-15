<?php

namespace App\Services;

use App\Models\MafiaRoom;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * The rooms anybody may see and enter: lobbies that can still be joined and
 * games in progress that can be watched. Password-protected rooms are private
 * and never listed. Finished and cancelled rooms are not listed.
 */
class MafiaRoomListService
{
    /**
     * @return Collection<int, array<string, mixed>>
     */
    public function publicRooms(?User $viewer = null, int $limit = 20): Collection
    {
        $friendIds = $viewer ? $viewer->friendIds() : collect();

        return MafiaRoom::query()
            ->whereNotIn('status', ['game_over', 'cancelled'])
            ->where('updated_at', '>=', now()->subHours(6))
            ->with(['players.user:id,name', 'host:id,name'])
            ->latest('updated_at')
            ->limit($limit * 2)
            ->get()
            ->reject(fn (MafiaRoom $room) => filled($room->settings['password_hash'] ?? null))
            ->take($limit)
            ->map(function (MafiaRoom $room) use ($friendIds) {
                $players = $room->players->filter(fn ($player) => $player->user_id !== null);
                $inLobby = $room->status === 'lobby';

                return [
                    'code' => $room->room_code,
                    'status' => $inLobby ? 'lobby' : 'playing',
                    'playersCount' => $players->count(),
                    'seats' => (int) config('mafia.seats'),
                    'host' => $room->host?->name,
                    'players' => $players->map(fn ($player) => $player->user?->name)->filter()->values()->all(),
                    'hasFriends' => $players->contains(fn ($player) => $friendIds->contains($player->user_id)),
                    'canJoin' => $inLobby && $players->count() < config('mafia.seats'),
                    'url' => route('mafia.show', $room->room_code),
                ];
            })
            ->values();
    }
}
