<?php

namespace App\Events\Mafia;

use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * The first (and so far only) real use of the private per-player channel
 * scaffolded back in Phase 2 — a covert signal genuinely has to reach
 * only its target, promptly, which the public-ping-then-authenticated-
 * fetch pattern used everywhere else isn't a good fit for (there's
 * nothing to "fetch" here — it's a one-off, ephemeral notification, not
 * durable room state).
 */
class MafiaSignalReceived implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public MafiaRoom $room,
        public MafiaPlayer $target,
        public int $fromSlot,
        public ?int $number,
        public ?string $color,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel("mafia.{$this->room->room_code}.player.{$this->target->id}")];
    }

    public function broadcastAs(): string
    {
        return 'signal.received';
    }

    public function broadcastWith(): array
    {
        return [
            'fromSlot' => $this->fromSlot,
            'number' => $this->number,
            'color' => $this->color,
        ];
    }
}
