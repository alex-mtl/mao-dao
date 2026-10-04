<?php

use App\Models\MafiaAction;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\User;

test('a mafia room belongs to a host and lists its players', function () {
    $host = User::factory()->create();
    $room = MafiaRoom::factory()->create(['host_user_id' => $host->id]);
    $player = MafiaPlayer::factory()->gameHost()->create(['mafia_room_id' => $room->id, 'user_id' => $host->id]);

    expect($room->host->is($host))->toBeTrue();
    expect($room->players)->toHaveCount(1);
    expect($room->players->first()->is($player))->toBeTrue();
    expect($player->is_game_host)->toBeTrue();
});

test('a mafia room defaults to the lobby status with the expected default settings', function () {
    $room = MafiaRoom::factory()->create();

    expect($room->status)->toBe('lobby');
    expect($room->settings)->toBe([
        'password_hash' => null,
        'registered_only' => false,
        'skip_role_shuffle' => true,
        'autohost' => true,
    ]);
});

test('a dummy mafia player has no linked user account but still holds a role', function () {
    $player = MafiaPlayer::factory()->dummy()->role('mafia')->create();

    expect($player->isDummy())->toBeTrue();
    expect($player->user)->toBeNull();
    expect($player->team())->toBe('black');
});

test('team() maps each role to its side, and is null before roles are dealt', function () {
    expect(MafiaPlayer::factory()->make(['role' => 'citizen'])->team())->toBe('red');
    expect(MafiaPlayer::factory()->make(['role' => 'sheriff'])->team())->toBe('red');
    expect(MafiaPlayer::factory()->make(['role' => 'mafia'])->team())->toBe('black');
    expect(MafiaPlayer::factory()->make(['role' => 'don'])->team())->toBe('black');
    expect(MafiaPlayer::factory()->make(['role' => null])->team())->toBeNull();
});

test('isAlive reflects the player status column', function () {
    expect(MafiaPlayer::factory()->make(['status' => 'alive'])->isAlive())->toBeTrue();
    expect(MafiaPlayer::factory()->make(['status' => 'killed'])->isAlive())->toBeFalse();
});

test('isJoinable is false once the room leaves the lobby or the table is full', function () {
    $room = MafiaRoom::factory()->create();
    expect($room->isJoinable())->toBeTrue();

    for ($slot = 1; $slot <= config('mafia.seats'); $slot++) {
        MafiaPlayer::factory()->create(['mafia_room_id' => $room->id, 'slot' => $slot]);
    }

    expect($room->fresh()->isJoinable())->toBeFalse();
    expect($room->fresh()->isFull())->toBeTrue();

    $startedRoom = MafiaRoom::factory()->inProgress()->create();
    expect($startedRoom->isJoinable())->toBeFalse();
});

test('a room cannot seat two players in the same slot', function () {
    $room = MafiaRoom::factory()->create();
    MafiaPlayer::factory()->create(['mafia_room_id' => $room->id, 'slot' => 1]);

    expect(fn () => MafiaPlayer::factory()->create(['mafia_room_id' => $room->id, 'slot' => 1]))
        ->toThrow(\Illuminate\Database\QueryException::class);
});

test('a room can seat any number of dummy (unfilled) players in the same slot-less state without colliding on user_id', function () {
    $room = MafiaRoom::factory()->create();

    $first = MafiaPlayer::factory()->dummy()->create(['mafia_room_id' => $room->id, 'slot' => 1]);
    $second = MafiaPlayer::factory()->dummy()->create(['mafia_room_id' => $room->id, 'slot' => 2]);

    expect($first->user_id)->toBeNull();
    expect($second->user_id)->toBeNull();
    expect($room->fresh()->players)->toHaveCount(2);
});

test('checkWinner declares the town once every black-team player is eliminated', function () {
    $room = MafiaRoom::factory()->create();
    MafiaPlayer::factory()->role('citizen')->create(['mafia_room_id' => $room->id, 'slot' => 1, 'status' => 'alive']);
    MafiaPlayer::factory()->role('sheriff')->create(['mafia_room_id' => $room->id, 'slot' => 2, 'status' => 'alive']);
    MafiaPlayer::factory()->role('mafia')->create(['mafia_room_id' => $room->id, 'slot' => 3, 'status' => 'killed']);
    MafiaPlayer::factory()->role('don')->create(['mafia_room_id' => $room->id, 'slot' => 4, 'status' => 'voted_out']);

    expect($room->checkWinner())->toBe('red');
});

test('checkWinner declares the mafia the moment their living count reaches parity with the town', function () {
    $room = MafiaRoom::factory()->create();
    MafiaPlayer::factory()->role('citizen')->create(['mafia_room_id' => $room->id, 'slot' => 1, 'status' => 'alive']);
    MafiaPlayer::factory()->role('sheriff')->create(['mafia_room_id' => $room->id, 'slot' => 2, 'status' => 'killed']);
    MafiaPlayer::factory()->role('mafia')->create(['mafia_room_id' => $room->id, 'slot' => 3, 'status' => 'alive']);
    MafiaPlayer::factory()->role('don')->create(['mafia_room_id' => $room->id, 'slot' => 4, 'status' => 'disqualified']);

    expect($room->checkWinner())->toBe('black');
});

test('checkWinner returns null while both teams are still alive and the mafia has not reached parity', function () {
    $room = MafiaRoom::factory()->create();
    MafiaPlayer::factory()->role('citizen')->create(['mafia_room_id' => $room->id, 'slot' => 1, 'status' => 'alive']);
    MafiaPlayer::factory()->role('citizen')->create(['mafia_room_id' => $room->id, 'slot' => 2, 'status' => 'alive']);
    MafiaPlayer::factory()->role('sheriff')->create(['mafia_room_id' => $room->id, 'slot' => 3, 'status' => 'alive']);
    MafiaPlayer::factory()->role('mafia')->create(['mafia_room_id' => $room->id, 'slot' => 4, 'status' => 'alive']);

    expect($room->checkWinner())->toBeNull();
});

test('a dummy player still counts toward its team for the win check', function () {
    $room = MafiaRoom::factory()->create();
    MafiaPlayer::factory()->role('citizen')->create(['mafia_room_id' => $room->id, 'slot' => 1, 'status' => 'alive']);
    MafiaPlayer::factory()->dummy()->role('mafia')->create(['mafia_room_id' => $room->id, 'slot' => 2, 'status' => 'alive']);

    expect($room->checkWinner())->toBe('black');
});

test('generateUniqueRoomCode never collides with an existing room', function () {
    $existing = MafiaRoom::factory()->create();

    $code = MafiaRoom::generateUniqueRoomCode();

    expect($code)->not->toBe($existing->room_code);
    expect(strlen($code))->toBe(6);
    expect($code)->toBe(strtoupper($code));
});

test('a mafia action belongs to its room, actor, and target, and has no updated_at', function () {
    $room = MafiaRoom::factory()->create();
    $actor = MafiaPlayer::factory()->create(['mafia_room_id' => $room->id, 'slot' => 1]);
    $target = MafiaPlayer::factory()->create(['mafia_room_id' => $room->id, 'slot' => 2]);

    $action = MafiaAction::factory()->create([
        'mafia_room_id' => $room->id,
        'actor_player_id' => $actor->id,
        'target_player_id' => $target->id,
        'action_type' => 'shoot',
    ]);

    expect($action->room->is($room))->toBeTrue();
    expect($action->actor->is($actor))->toBeTrue();
    expect($action->target->is($target))->toBeTrue();
    expect($action->updated_at)->toBeNull();
    expect($action->created_at)->not->toBeNull();
});
