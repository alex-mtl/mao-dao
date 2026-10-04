<?php

use App\Models\MafiaAction;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\User;

function mafiaRoomWithLivePlayers(array $slotRoles, string $status = 'day', ?string $stage = null, array $state = []): MafiaRoom
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

// Only the current speaker may nominate — confirmed directly against
// ttl10's own source that its server actually accepts a nomination from
// any alive player at any point in the discussion stage (the turn
// restriction real ttl10 play always shows is CSS-only, never enforced
// server-side); this port makes it a genuine server-side rule instead,
// matching this app's existing "no client-side-only enforcement"
// standard. See MafiaController::nominate()'s own docblock.
test('the current speaker can nominate another living player', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'speaking', state: ['speaking_order' => [1]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[2]->id]);

    expect(MafiaAction::where('action_type', 'nominate')->where('actor_player_id', $players[1]->id)->where('target_player_id', $players[2]->id)->exists())->toBeTrue();
});

test('a player who is not the current speaker cannot nominate', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], stage: 'speaking', state: ['speaking_order' => [3]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[2]->id]);

    expect(MafiaAction::where('action_type', 'nominate')->count())->toBe(0);
});

test('nominating your own current pick again withdraws it', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'speaking', state: ['speaking_order' => [1]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[2]->id]);
    expect($room->fresh()->currentNominees())->toBe([$players[2]->id]);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[2]->id]);
    expect($room->fresh()->currentNominees())->toBe([]);
});

test('nominating a different target replaces the speaker\'s previous pick', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], stage: 'speaking', state: ['speaking_order' => [1]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[2]->id]);
    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[3]->id]);

    expect($room->fresh()->currentNominees())->toBe([$players[3]->id]);
});

test('a player cannot nominate themselves', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'speaking', state: ['speaking_order' => [1]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[1]->id]);

    expect(MafiaAction::where('action_type', 'nominate')->count())->toBe(0);
});

test('a dead player cannot nominate anyone', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'speaking', state: ['speaking_order' => [1]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['status' => 'killed']);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[2]->id]);

    expect(MafiaAction::where('action_type', 'nominate')->count())->toBe(0);
});

test('nominating outside the speaking stage is silently ignored', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'voting');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[2]->id]);

    expect(MafiaAction::where('action_type', 'nominate')->count())->toBe(0);
});

test('a player can only vote for a candidate that is actually in this round', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], stage: 'voting');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['state' => ['voting_candidates' => [$players[2]->id], 'voting_queue' => []]]);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/vote", ['candidate_player_id' => $players[3]->id]);
    expect(MafiaAction::where('action_type', 'vote')->count())->toBe(0);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/vote", ['candidate_player_id' => $players[2]->id]);
    expect(MafiaAction::where('action_type', 'vote')->where('target_player_id', $players[2]->id)->exists())->toBeTrue();
});

test('only a living mafia-team player can shoot', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], status: 'shooting');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/shoot", ['target_player_id' => $players[2]->id]);
    expect(MafiaAction::where('action_type', 'shoot')->count())->toBe(0);

    $this->actingAs($players[3]->user)->post("/mafia/{$room->room_code}/shoot", ['target_player_id' => $players[2]->id]);
    expect(MafiaAction::where('action_type', 'shoot')->where('actor_player_id', $players[3]->id)->exists())->toBeTrue();
});

test('a mafia member can abstain from shooting with no target', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'mafia'], status: 'shooting');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[2]->user)->post("/mafia/{$room->room_code}/shoot", []);

    $action = MafiaAction::where('action_type', 'shoot')->first();
    expect($action)->not->toBeNull();
    expect($action->target_player_id)->toBeNull();
});

test('the don can check a player killed earlier the very same night', function () {
    // The check-independent-of-death correction (plan §7): the check
    // phase runs right after shooting resolves, so the target may already
    // be dead from tonight's kill — the check must still work and return
    // the true result.
    $room = mafiaRoomWithLivePlayers([1 => 'sheriff', 2 => 'don'], status: 'don_check');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['status' => 'killed']);

    $this->actingAs($players[2]->user)->post("/mafia/{$room->room_code}/don-check", ['target_player_id' => $players[1]->id]);

    $action = MafiaAction::where('action_type', 'don_check')->first();
    expect($action)->not->toBeNull();
    expect($action->target_player_id)->toBe($players[1]->id);
});

test('the don can never check the same target twice, even on a later night', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'sheriff', 2 => 'don'], status: 'don_check');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[2]->user)->post("/mafia/{$room->room_code}/don-check", ['target_player_id' => $players[1]->id]);
    expect(MafiaAction::where('action_type', 'don_check')->count())->toBe(1);

    // A later night, same don, same target — still rejected.
    $room->update(['current_day' => 2]);
    $this->actingAs($players[2]->user)->post("/mafia/{$room->room_code}/don-check", ['target_player_id' => $players[1]->id]);
    expect(MafiaAction::where('action_type', 'don_check')->count())->toBe(1);
});

test('only the sheriff can use the sheriff check, and the result reflects team, not exact role', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'sheriff', 2 => 'mafia', 3 => 'citizen'], status: 'sheriff_check');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[3]->user)->post("/mafia/{$room->room_code}/sheriff-check", ['target_player_id' => $players[2]->id]);
    expect(MafiaAction::where('action_type', 'sheriff_check')->count())->toBe(0);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/sheriff-check", ['target_player_id' => $players[2]->id]);
    expect(MafiaAction::where('action_type', 'sheriff_check')->where('target_player_id', $players[2]->id)->exists())->toBeTrue();
});

test('only the current speaker can pass their own turn', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], stage: 'speaking');
    $room->update(['state' => ['speaking_order' => [1, 2, 3], 'spoken_slots' => []]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $originalDeadline = $room->phase_deadline_at;

    $this->actingAs($players[2]->user)->post("/mafia/{$room->room_code}/pass");
    expect($room->fresh()->phase_deadline_at)->toEqual($originalDeadline);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/pass");
    expect($room->fresh()->phase_deadline_at)->not->toEqual($originalDeadline);
});

test('the player currently giving their last speech can pass it early', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'last_speech');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['state' => ['current_elimination' => $players[1]->id]]);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/pass");

    expect($room->fresh()->phase_deadline_at->isPast())->toBeTrue();
});

test('the play page exposes a full check history that survives the target dying afterward', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'sheriff', 2 => 'mafia'], status: 'day', stage: 'speaking');
    $room->update(['state' => ['speaking_order' => [1, 2], 'spoken_slots' => []]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    MafiaAction::create([
        'mafia_room_id' => $room->id, 'day' => 1, 'phase' => 'sheriff_check',
        'actor_player_id' => $players[1]->id, 'target_player_id' => $players[2]->id, 'action_type' => 'sheriff_check',
    ]);
    $players[2]->update(['status' => 'killed']);

    $response = $this->actingAs($players[1]->user)->get("/mafia/{$room->room_code}/play");

    $response->assertInertia(fn ($page) => $page
        ->component('Mafia/Play')
        ->where('snapshot.sheriffCheckHistory.0.slot', $players[2]->slot)
        ->where('snapshot.sheriffCheckHistory.0.isBlackTeam', true)
    );
});

test('a mafia player sees their teammates roles, but a citizen sees no teammates at all', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'mafia', 3 => 'don'], status: 'day', stage: 'speaking');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $mafiaResponse = $this->actingAs($players[2]->user)->get("/mafia/{$room->room_code}/play");
    $mafiaResponse->assertInertia(fn ($page) => $page
        ->component('Mafia/Play')
        ->has('snapshot.mafiaTeammates', 1)
        ->where('snapshot.mafiaTeammates.0.slot', $players[3]->slot)
        ->where('snapshot.mafiaTeammates.0.role', 'don')
    );

    $citizenResponse = $this->actingAs($players[1]->user)->get("/mafia/{$room->room_code}/play");
    $citizenResponse->assertInertia(fn ($page) => $page
        ->component('Mafia/Play')
        ->has('snapshot.mafiaTeammates', 0)
    );
});

// Reported directly: a player giving their last word (voted out or
// killed) or a tie-break defense speech got no visual indicator of who's
// speaking or how much time is left, even though the ttl10-style
// circular countdown ring (§16) already existed for normal speaking-order
// turns. The ring is driven purely by `speechTimer`, which Play.jsx
// derives from `currentSpeakerSlot`/`speechDurationMs` — so the fix is
// these two snapshot fields recognizing all three "someone has the
// floor" stages, not just 'speaking'. See MafiaController::roomSnapshot().
test('a last speech populates currentSpeakerSlot and speechDurationMs for the ring', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'last_speech');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['state' => ['current_elimination' => $players[2]->id]]);

    $response = $this->actingAs($players[1]->user)->get("/mafia/{$room->room_code}/play");

    $response->assertInertia(fn ($page) => $page
        ->component('Mafia/Play')
        ->where('snapshot.currentSpeakerSlot', $players[2]->slot)
        ->where('snapshot.speechDurationMs', config('mafia.timers_ms.last_speech'))
        ->where('snapshot.canNominate', false)
    );
});

test('a defense speech populates currentSpeakerSlot and speechDurationMs for the ring', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], stage: 'defense_speech');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['state' => ['defense_queue' => [$players[3]->id, $players[1]->id]]]);

    $response = $this->actingAs($players[2]->user)->get("/mafia/{$room->room_code}/play");

    $response->assertInertia(fn ($page) => $page
        ->component('Mafia/Play')
        ->where('snapshot.currentSpeakerSlot', $players[3]->slot)
        ->where('snapshot.speechDurationMs', config('mafia.timers_ms.defense_speech'))
        ->where('snapshot.canNominate', false)
    );
});

// The speaker-turn nomination rule (§18) must stay scoped to the normal
// speaking stage even though currentSpeakerSlot is now also populated
// during a last/defense speech — nominating isn't a thing there.
test('a player cannot nominate during their own last speech', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'last_speech');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['state' => ['current_elimination' => $players[1]->id]]);

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[2]->id]);

    expect(MafiaAction::where('mafia_room_id', $room->id)->where('action_type', 'nominate')->count())->toBe(0);
});

test('seat roles are hidden mid-game and fully revealed once the game is over', function () {
    $room = mafiaRoomWithLivePlayers([1 => 'citizen', 2 => 'mafia'], status: 'day', stage: 'speaking');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $midGame = $this->actingAs($players[1]->user)->get("/mafia/{$room->room_code}/play");
    $midGame->assertInertia(fn ($page) => $page
        ->component('Mafia/Play')
        ->where('snapshot.seats.0.role', null)
        ->where('snapshot.seats.1.role', null)
    );

    $room->update(['status' => 'game_over', 'winner_team' => 'red']);

    $afterGame = $this->actingAs($players[1]->user)->get("/mafia/{$room->room_code}/play");
    $afterGame->assertInertia(fn ($page) => $page
        ->component('Mafia/Play')
        ->where('snapshot.seats.0.role', 'citizen')
        ->where('snapshot.seats.1.role', 'mafia')
    );
});
