<?php

namespace App\Events\Mafia;

use App\Models\MafiaRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Broadcast on a public channel: seat occupancy and ready-state aren't
 * sensitive (unlike a dealt role, which never travels over this channel —
 * see the "Mafia Extension" plan §5.1). Fired on join and on every ready
 * toggle, so the lobby UI just re-renders the seat list rather than
 * reconciling fine-grained diffs.
 *
 * ShouldBroadcastNow, not ShouldBroadcast: this app has no queue worker
 * (same reasoning as every Race Mode event).
 */
class MafiaLobbyUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public MafiaRoom $room)
    {
    }

    public function broadcastOn(): array
    {
        return [new Channel("mafia.{$this->room->room_code}")];
    }

    public function broadcastAs(): string
    {
        return 'lobby.updated';
    }

    public function broadcastWith(): array
    {
        return [
            'players' => $this->room->players()->with('user.media')->orderBy('slot')->get()->map(fn ($p) => [
                'id' => $p->id,
                'slot' => $p->slot,
                'name' => $p->user?->name,
                'avatarUrl' => $p->user?->profile_photo_url,
                'isGameHost' => $p->is_game_host,
                'isReady' => $p->is_ready,
            ])->values()->all(),
        ];
    }
}
