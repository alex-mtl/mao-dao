<?php

namespace App\Events\Race;

use App\Models\RaceRoom;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

class RaceQuestionStarted implements ShouldBroadcastNow
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
        return 'question.started';
    }

    public function broadcastWith(): array
    {
        $question = $this->room->currentQuestion();

        return [
            'questionIndex' => $this->room->current_question_index,
            'totalQuestions' => count($this->room->question_order),
            'question' => [
                'id' => $question->id,
                'text' => $question->text,
                // Deliberately no `is_correct` — never sent to the
                // browser before the question has ended.
                'answers' => $question->answers->map(fn ($answer) => [
                    'id' => $answer->id,
                    'text' => $answer->text,
                ]),
            ],
            'deadlineAt' => $this->room->current_question_deadline_at?->toIso8601String(),
        ];
    }
}
