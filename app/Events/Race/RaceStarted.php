<?php

namespace App\Events\Race;

use App\Models\RaceRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

class RaceStarted implements ShouldBroadcastNow
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
        return 'race.starting';
    }

    public function broadcastWith(): array
    {
        return [
            // Absolute server timestamp — clients render a countdown to
            // this moment, they never decide when it happens.
            'goAt' => $this->room->started_at?->toIso8601String(),
        ];
    }
}
