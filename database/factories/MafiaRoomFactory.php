<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class MafiaRoomFactory extends Factory
{
    public function definition(): array
    {
        return [
            'host_user_id' => User::factory(),
            'room_code' => strtoupper(Str::random(6)),
            'status' => 'lobby',
            'settings' => [
                'password_hash' => null,
                'registered_only' => false,
                'skip_role_shuffle' => true,
                'autohost' => true,
            ],
            'current_day' => 0,
        ];
    }

    public function inProgress(): static
    {
        return $this->state(fn () => [
            'status' => 'day',
            'current_day' => 1,
            'started_at' => now(),
        ]);
    }

    public function finished(string $winnerTeam = 'red'): static
    {
        return $this->state(fn () => [
            'status' => 'game_over',
            'winner_team' => $winnerTeam,
            'started_at' => now()->subMinutes(20),
            'finished_at' => now(),
        ]);
    }
}
