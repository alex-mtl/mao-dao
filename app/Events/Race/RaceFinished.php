<?php

namespace App\Events\Race;

use App\Models\RaceRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

class RaceFinished implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public RaceRoom $room)
    {
    }

    public function broadcastOn(): array
    {
        return [new Channel("race.{$this->room->room_code}")];
    }

    public function broadcastAs(): string
    {
        return 'race.finished';
    }

    public function broadcastWith(): array
    {
        return ['leaderboard' => $this->room->leaderboard()];
    }
}
