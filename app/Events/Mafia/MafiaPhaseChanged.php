<?php

namespace App\Events\Mafia;

use App\Models\MafiaRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired on every phase/stage transition MafiaGameEngine makes. Carries
 * only the new status/stage/day/deadline — never anyone's role, a check
 * result, or who voted for what. Clients treat this purely as a "go
 * re-fetch your own state" signal (see useMafiaChannel.js): the actual
 * personalized data comes back from the authenticated GET /state request
 * it triggers, not from this broadcast. That two-step "public ping,
 * authenticated fetch" pattern is what keeps hidden information hidden
 * without needing the private per-player channel scaffolded in
 * routes/channels.php — see the "Mafia Extension" plan §5.1/Phase 3 notes.
 */
class MafiaPhaseChanged implements ShouldBroadcastNow
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
        return 'phase.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'status' => $this->room->status,
            'stage' => $this->room->stage,
            'day' => $this->room->current_day,
            'deadlineAt' => $this->room->phase_deadline_at?->toIso8601String(),
        ];
    }
}
