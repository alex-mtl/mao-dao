<?php

namespace Database\Factories;

use App\Models\Quiz;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class RaceRoomFactory extends Factory
{
    public function definition(): array
    {
        return [
            'quiz_id' => Quiz::factory()->published(),
            'host_user_id' => User::factory(),
            'room_code' => strtoupper(Str::random(6)),
            'status' => 'lobby',
            'question_order' => null,
            'current_question_index' => 0,
            'max_players' => config('race.default_max_players'),
        ];
    }

    public function starting(): static
    {
        return $this->state(fn () => ['status' => 'starting']);
    }

    public function question(): static
    {
        return $this->state(fn () => [
            'status' => 'question',
            'started_at' => now(),
            'current_question_started_at' => now(),
            'current_question_deadline_at' => now()->addSeconds(config('race.question_time_limit_seconds')),
        ]);
    }

    public function finished(): static
    {
        return $this->state(fn () => [
            'status' => 'finished',
            'started_at' => now()->subMinutes(5),
            'finished_at' => now(),
        ]);
    }
}
