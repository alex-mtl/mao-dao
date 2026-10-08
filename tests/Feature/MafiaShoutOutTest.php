<?php

use App\Models\MafiaAction;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\User;
use App\Services\Mafia\MafiaGameEngine;

function shoutRoom(array $slotRoles, string $status = 'day', ?string $stage = 'speaking', array $state = []): MafiaRoom
{
    $room = MafiaRoom::factory()->create(['status' => $status, 'stage' => $stage, 'current_day' => 1, 'state' => $state]);

    foreach ($slotRoles as $slot => $role) {
        MafiaPlayer::factory()->role($role)->create([
            'mafia_room_id' => $room->id,
            'user_id' => User::factory()->create()->id,
            'slot' => $slot,
        ]);
    }

    return $room->fresh();
}

function shoutPost($test, MafiaRoom $room, MafiaPlayer $player)
{
    return $test->actingAs($player->user)->post("/mafia/{$room->room_code}/shout-out");
}

test('a living player can shout out during the day: they get a warning and an open mic window', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don'], state: ['speaking_order' => [1, 2, 3, 4]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    shoutPost($this, $room, $players[3])->assertRedirect();

    expect($players[3]->fresh()->warnings)->toBe(1);
    expect(MafiaAction::where('action_type', 'shout_out')->where('actor_player_id', $players[3]->id)->count())->toBe(1);
    expect(array_keys($room->fresh()->activeShouts()))->toBe([$players[3]->id]);
});

test('while the window is open the shouter is audible next to the current speaker, then silent again', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don'], state: ['speaking_order' => [1, 2, 3, 4]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    expect($room->micPolicy())->toBe(['mode' => 'only', 'playerIds' => [$players[1]->id]]);

    shoutPost($this, $room, $players[3]);
    $policy = $room->fresh()->micPolicy();
    expect($policy['mode'])->toBe('only');
    expect($policy['playerIds'])->toEqualCanonicalizing([$players[1]->id, $players[3]->id]);

    // Window passes.
    $action = MafiaAction::where('action_type', 'shout_out')->firstOrFail();
    $action->update(['value' => ['ends_at' => now()->subSecond()->toIso8601String()]]);

    expect($room->fresh()->micPolicy())->toBe(['mode' => 'only', 'playerIds' => [$players[1]->id]]);
});

test('a shout-out is audible even when nobody else holds the floor (e.g. during voting)', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], stage: 'voting', state: ['voting_candidates' => [1]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    shoutPost($this, $room, $players[2]);

    expect($room->fresh()->micPolicy())->toBe(['mode' => 'only', 'playerIds' => [$players[2]->id]]);
});

test('the player holding the floor cannot shout out, and gets no warning for trying', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], state: ['speaking_order' => [1, 2, 3]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    shoutPost($this, $room, $players[1]);

    expect($players[1]->fresh()->warnings)->toBe(0);
    expect(MafiaAction::where('action_type', 'shout_out')->count())->toBe(0);
});

test('pressing again while a window is open does not stack another warning', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], state: ['speaking_order' => [1, 2, 3]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    shoutPost($this, $room, $players[2]);
    shoutPost($this, $room, $players[2]);

    expect($players[2]->fresh()->warnings)->toBe(1);
});

test('shouting out is a daytime action for living players only', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], status: 'night', stage: null);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    shoutPost($this, $room, $players[2]);
    expect($players[2]->fresh()->warnings)->toBe(0);

    $room->update(['status' => 'day', 'stage' => 'speaking', 'state' => ['speaking_order' => [1]]]);
    $players[2]->update(['status' => 'killed']);
    shoutPost($this, $room, $players[2]);
    expect($players[2]->fresh()->warnings)->toBe(0);
});

test('the 4th warning disqualifies the player, which counts as an elimination for the win check', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], state: ['speaking_order' => [1, 2, 3]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[3]->update(['warnings' => 3]);

    shoutPost($this, $room, $players[3]);

    expect($players[3]->fresh()->status)->toBe('disqualified');
    expect($players[3]->fresh()->warnings)->toBe(4);
    $room->refresh();
    expect($room->status)->toBe('game_over');
    expect($room->winner_team)->toBe('red');
});

test('a disqualification that does not end the game leaves it running', function () {
    // 4 red vs 2 black: losing one red player (3 vs 2) is nowhere near parity.
    $room = shoutRoom([1 => 'citizen', 2 => 'citizen', 3 => 'citizen', 4 => 'sheriff', 5 => 'mafia', 6 => 'don'], state: ['speaking_order' => [1, 2, 3, 4, 5, 6]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[2]->update(['warnings' => 3]);

    shoutPost($this, $room, $players[2]);

    expect($players[2]->fresh()->status)->toBe('disqualified');
    expect($room->fresh()->status)->toBe('day');
});

test('the 3rd warning cuts exactly one speaking turn to the short length', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don'], state: ['speaking_order' => [1, 2, 3, 4], 'spoken_slots' => []]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[2]->update(['warnings' => 3]);

    // Slot 1's turn ends -> slot 2 (3 warnings) is up next.
    app(MafiaGameEngine::class)->advance($room->fresh());
    $room->refresh();
    expect($room->dayState()['speech_total_ms'])->toBe(config('mafia.timers_ms.warned_speech'));
    expect($players[2]->fresh()->warned_speech_used)->toBeTrue();

    // A later turn for the same player is back to normal length.
    $room->update(['state' => ['speaking_order' => [1, 2], 'spoken_slots' => []]]);
    app(MafiaGameEngine::class)->advance($room->fresh());
    expect($room->fresh()->dayState()['speech_total_ms'])->toBe(config('mafia.timers_ms.speech'));
});

test('a player disqualified while waiting for their turn is skipped', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'citizen', 3 => 'sheriff', 4 => 'mafia', 5 => 'don'], state: ['speaking_order' => [1, 2, 3, 4, 5], 'spoken_slots' => []]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[2]->update(['status' => 'disqualified', 'warnings' => 4]);

    app(MafiaGameEngine::class)->advance($room->fresh());

    expect($room->fresh()->dayState()['speaking_order'])->toBe([3, 4, 5]);
});

test('the play snapshot exposes every seat\'s warnings, open shout windows, and whether you can shout', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], state: ['speaking_order' => [1, 2, 3]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[2]->update(['warnings' => 2]);

    $before = $this->actingAs($players[3]->user)->get("/mafia/{$room->room_code}/state")->assertOk()->json();
    expect($before['canShoutOut'])->toBeTrue();
    expect(collect($before['seats'])->firstWhere('slot', 2)['warnings'])->toBe(2);
    expect(collect($before['seats'])->firstWhere('slot', 3)['shoutEndsAt'])->toBeNull();

    shoutPost($this, $room, $players[3]);

    $after = $this->actingAs($players[3]->user)->get("/mafia/{$room->room_code}/state")->json();
    expect($after['canShoutOut'])->toBeFalse();
    expect(collect($after['seats'])->firstWhere('slot', 3)['shoutEndsAt'])->toBeString();
    expect(collect($after['seats'])->firstWhere('slot', 3)['warnings'])->toBe(1);
    // Everyone sees everyone's counter, not just their own.
    expect(collect($after['seats'])->firstWhere('slot', 2)['warnings'])->toBe(2);
});

test('the real length of the current turn is what the countdown ring is told', function () {
    $room = shoutRoom([1 => 'citizen', 2 => 'sheriff'], state: ['speaking_order' => [1, 2], 'speech_total_ms' => 10000]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $state = $this->actingAs($players[2]->user)->get("/mafia/{$room->room_code}/state")->json();

    expect($state['speechDurationMs'])->toBe(10000);
});
