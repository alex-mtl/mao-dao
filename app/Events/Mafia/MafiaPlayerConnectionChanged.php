<?php

namespace App\Events\Mafia;

use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired whenever a player's connection_status actually changes (flagged
 * disconnected by mafia:tick, or reconnected via their next request going
 * through ResolveMafiaPlayer) — not on every heartbeat. Public: which
 * seat is having connectivity trouble isn't sensitive.
 */
class MafiaPlayerConnectionChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public MafiaRoom $room, public MafiaPlayer $player)
    {
    }

    public function broadcastOn(): array
    {
        return [new Channel("mafia.{$this->room->room_code}")];
    }

    public function broadcastAs(): string
    {
        return 'player.connection-changed';
    }

    public function broadcastWith(): array
    {
        return [
            'slot' => $this->player->slot,
            'connectionStatus' => $this->player->connection_status,
        ];
    }
}
