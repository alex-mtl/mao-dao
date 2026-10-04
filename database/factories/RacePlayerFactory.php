<?php

namespace Database\Factories;

use App\Models\RaceRoom;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class RacePlayerFactory extends Factory
{
    public function definition(): array
    {
        return [
            'race_room_id' => RaceRoom::factory(),
            'user_id' => null,
            'nickname' => fake()->firstName(),
            'session_token' => Str::random(64),
            'is_host' => false,
            'score' => 0,
            'joined_at' => now(),
        ];
    }

    public function host(): static
    {
        return $this->state(fn () => ['is_host' => true]);
    }
}
