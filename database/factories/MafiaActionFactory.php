<?php

namespace Database\Factories;

use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use Illuminate\Database\Eloquent\Factories\Factory;

class MafiaActionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'mafia_room_id' => MafiaRoom::factory(),
            'day' => 1,
            'phase' => 'shooting',
            'actor_player_id' => MafiaPlayer::factory(),
            'target_player_id' => null,
            'action_type' => 'shoot',
            'value' => null,
        ];
    }
}
