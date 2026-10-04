<?php

namespace App\Events\Race;

use App\Models\RaceRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

class RaceQuestionEnded implements ShouldBroadcastNow
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
        return 'question.ended';
    }

    public function broadcastWith(): array
    {
        $question = $this->room->currentQuestion();

        return [
            'questionIndex' => $this->room->current_question_index,
            'correctAnswerId' => $question->correctAnswer()?->id,
            'leaderboard' => $this->room->leaderboard(),
            'revealUntil' => $this->room->results_reveal_until?->toIso8601String(),
        ];
    }
}
