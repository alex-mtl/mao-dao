<?php

namespace App\Events\Mafia;

use App\Models\MafiaRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

class MafiaGameOver implements ShouldBroadcastNow
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
        return 'game.over';
    }

    public function broadcastWith(): array
    {
        return ['winnerTeam' => $this->room->winner_team];
    }
}
