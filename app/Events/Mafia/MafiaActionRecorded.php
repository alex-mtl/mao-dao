<?php

namespace App\Events\Mafia;

use App\Models\MafiaRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired every time any player action (nominate, vote, lock-vote, shoot,
 * a don/sheriff check, a disconnect-vote) gets recorded — not just on a
 * phase/stage transition like MafiaPhaseChanged. Reported directly: the
 * app only ever pushed on a full phase change, so anything happening
 * *within* a stage (a nomination changing, a vote coming in) was
 * invisible to everyone else until the next unrelated broadcast or the
 * 12-second heartbeat poll happened to land — nowhere near the "instant"
 * feel ttl10 itself has (see the plan doc's real-time architecture
 * correction). Carries no hidden information whatsoever — not even which
 * action type or who — for the same reason MafiaPhaseChanged doesn't:
 * clients treat this purely as a "go re-fetch your own state" signal
 * (useMafiaChannel.js), and the actual personalized data comes back from
 * the authenticated GET /state request it triggers. Dispatched from one
 * choke point, MafiaController::recordAction(), so every action type
 * that ever calls it gets this for free without each call site needing
 * its own dispatch.
 */
class MafiaActionRecorded implements ShouldBroadcastNow
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
        return 'action.recorded';
    }
}
