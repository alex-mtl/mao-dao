<?php

namespace App\Events\Race;

use App\Models\RaceRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Broadcast on a public channel, not private: Race state (nicknames,
 * scores, question text/options, timer) isn't sensitive, and public
 * channels avoid needing a broadcasting-auth endpoint for anonymous
 * guests entirely. Every write action is still fully authorized
 * server-side regardless of channel visibility.
 *
 * ShouldBroadcastNow (not ShouldBroadcast): this app's queue has no
 * worker running anything dispatched to it would never actually fire.
 */
class RacePlayerJoined implements ShouldBroadcastNow
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
        return 'player.joined';
    }

    public function broadcastWith(): array
    {
        return ['players' => $this->room->leaderboard()];
    }
}
