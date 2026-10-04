<?php

namespace App\Events\Race;

use App\Models\RaceRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Broadcast on the OLD (finished) room's channel so players still sitting
 * on the final-results screen can see a new race was started and follow
 * the host into it — the old room itself is never reset or reused, per
 * spec §21 ("Play Again" creates a NEW Race Room, completed sessions stay
 * internally consistent).
 */
class RacePlayAgain implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public RaceRoom $oldRoom, public RaceRoom $newRoom)
    {
    }

    public function broadcastOn(): array
    {
        return [new Channel("race.{$this->oldRoom->room_code}")];
    }

    public function broadcastAs(): string
    {
        return 'race.play-again';
    }

    public function broadcastWith(): array
    {
        return ['newRoomCode' => $this->newRoom->room_code];
    }
}
