<?php

namespace App\Events\Mafia;

use App\Models\MafiaRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired once every seated player is ready and roles have just been dealt
 * (see MafiaController::startGame()). Deliberately carries only the new
 * status and the "go at" timestamp — never anyone's dealt role, which
 * stays scoped to that player's own next page load.
 */
class MafiaGameStarting implements ShouldBroadcastNow
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
        return 'game.starting';
    }

    public function broadcastWith(): array
    {
        return [
            'status' => $this->room->status,
            'goAt' => $this->room->started_at?->toIso8601String(),
        ];
    }
}
