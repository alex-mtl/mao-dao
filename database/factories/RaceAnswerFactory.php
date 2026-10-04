<?php

namespace Database\Factories;

use App\Models\Answer;
use App\Models\Question;
use App\Models\RacePlayer;
use Illuminate\Database\Eloquent\Factories\Factory;

class RaceAnswerFactory extends Factory
{
    public function definition(): array
    {
        return [
            'race_player_id' => RacePlayer::factory(),
            'question_id' => Question::factory(),
            'answer_id' => Answer::factory(),
            'is_correct' => false,
            'response_time_ms' => fake()->numberBetween(500, 15000),
            'points' => 0,
        ];
    }
}
