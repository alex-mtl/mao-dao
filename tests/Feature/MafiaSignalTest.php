<?php

use App\Events\Mafia\MafiaSignalReceived;
use App\Models\MafiaAction;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\User;
use Illuminate\Support\Facades\Event;

function signalRoomWithPlayers(int $count, string $status = 'day'): MafiaRoom
{
    $room = MafiaRoom::factory()->create(['status' => $status, 'current_day' => 1]);

    for ($slot = 1; $slot <= $count; $slot++) {
        MafiaPlayer::factory()->role('citizen')->create([
            'mafia_room_id' => $room->id,
            'user_id' => User::factory()->create()->id,
            'slot' => $slot,
        ]);
    }

    return $room->fresh();
}

test('a living player can send a signal with a number and color to another living player', function () {
    Event::fake([MafiaSignalReceived::class]);
    $room = signalRoomWithPlayers(2);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/signal", [
        'target_player_id' => $players[2]->id, 'number' => 7, 'color' => 'red',
    ]);

    $action = MafiaAction::where('action_type', 'signal')->first();
    expect($action)->not->toBeNull();
    expect($action->actor_player_id)->toBe($players[1]->id);
    expect($action->target_player_id)->toBe($players[2]->id);
    expect($action->value['number'])->toBe(7);
    expect($action->value['color'])->toBe('red');

    Event::assertDispatched(MafiaSignalReceived::class, fn ($e) => $e->fromSlot === 1 && $e->number === 7 && $e->color === 'red');
});

test('a signal can be sent with neither a number nor a color', function () {
    $room = signalRoomWithPlayers(2);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/signal", [
        'target_player_id' => $players[2]->id,
    ]);

    $action = MafiaAction::where('action_type', 'signal')->first();
    expect($action->value['number'])->toBeNull();
    expect($action->value['color'])->toBeNull();
});

test('a player cannot signal themselves', function () {
    $room = signalRoomWithPlayers(2);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/signal", [
        'target_player_id' => $players[1]->id,
    ]);

    expect(MafiaAction::where('action_type', 'signal')->count())->toBe(0);
});

test('a dead player cannot send a signal', function () {
    $room = signalRoomWithPlayers(2);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['status' => 'killed']);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/signal", [
        'target_player_id' => $players[2]->id,
    ]);

    expect(MafiaAction::where('action_type', 'signal')->count())->toBe(0);
});

test('a signal cannot target a dead player', function () {
    $room = signalRoomWithPlayers(2);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[2]->update(['status' => 'killed']);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/signal", [
        'target_player_id' => $players[2]->id,
    ]);

    expect(MafiaAction::where('action_type', 'signal')->count())->toBe(0);
});

test('a signal cannot be sent once the game is over', function () {
    $room = signalRoomWithPlayers(2, status: 'game_over');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/signal", [
        'target_player_id' => $players[2]->id,
    ]);

    expect(MafiaAction::where('action_type', 'signal')->count())->toBe(0);
});
