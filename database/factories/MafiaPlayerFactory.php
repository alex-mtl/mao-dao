<?php

namespace Database\Factories;

use App\Models\MafiaRoom;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

class MafiaPlayerFactory extends Factory
{
    public function definition(): array
    {
        return [
            'mafia_room_id' => MafiaRoom::factory(),
            'user_id' => User::factory(),
            // Not unique by default — slot only needs to be unique per
            // room, not globally, so tests seating multiple players in the
            // same room must pass 'slot' explicitly (see RacePlayerFactory
            // for the same non-unique-default convention).
            'slot' => 1,
            'role' => null,
            'status' => 'alive',
            'warnings' => 0,
            'is_ready' => false,
            'is_game_host' => false,
            'connection_status' => 'connected',
            'joined_at' => now(),
        ];
    }

    public function role(string $role): static
    {
        return $this->state(fn () => ['role' => $role]);
    }

    /**
     * An unfilled seat — see MafiaPlayer::isDummy().
     */
    public function dummy(): static
    {
        return $this->state(fn () => ['user_id' => null, 'joined_at' => null]);
    }

    public function dead(string $status = 'killed'): static
    {
        return $this->state(fn () => ['status' => $status]);
    }

    public function gameHost(): static
    {
        return $this->state(fn () => ['is_game_host' => true]);
    }

    public function disconnected(): static
    {
        return $this->state(fn () => [
            'connection_status' => 'disconnected',
            'disconnected_at' => now(),
        ]);
    }
}
