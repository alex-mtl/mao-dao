<?php

use App\Events\Mafia\MafiaGameOver;
use App\Models\MafiaAction;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\User;
use App\Services\Mafia\MafiaGameEngine;
use Illuminate\Support\Facades\Event;

/**
 * Small, synthetic rooms (not the real 10-seat deal) built with explicit
 * roles per slot — the engine doesn't hardcode a seat count anywhere
 * (that's a MafiaController::startGame() concern), so a 3-5 player room
 * exercises the same logic with far less setup per test.
 */
function mafiaRoomWithRoles(array $slotRoles, string $status = 'sitdown'): MafiaRoom
{
    $room = MafiaRoom::factory()->create(['status' => $status, 'current_day' => 0]);

    foreach ($slotRoles as $slot => $role) {
        MafiaPlayer::factory()->role($role)->create([
            'mafia_room_id' => $room->id,
            'user_id' => User::factory()->create()->id,
            'slot' => $slot,
        ]);
    }

    return $room->fresh();
}

function castVote(MafiaRoom $room, MafiaPlayer $voter, MafiaPlayer $candidate, string $actionType = 'vote'): void
{
    MafiaAction::create([
        'mafia_room_id' => $room->id,
        'day' => $room->current_day,
        'phase' => 'day',
        'actor_player_id' => $voter->id,
        'target_player_id' => $actionType === 'lock_vote' ? null : $candidate->id,
        'action_type' => $actionType,
    ]);
}

test('sitdown advances through don-watch and sheriff-watch into day 1 speaking', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don']);
    $engine = app(MafiaGameEngine::class);

    $engine->advance($room->fresh());
    expect($room->fresh()->status)->toBe('don_watch');

    $engine->advance($room->fresh());
    expect($room->fresh()->status)->toBe('sheriff_watch');

    $engine->advance($room->fresh());
    $room->refresh();
    expect($room->status)->toBe('day');
    expect($room->stage)->toBe('speaking');
    expect($room->current_day)->toBe(1);
    expect($room->dayState()['speaking_order'])->toBe([1, 2, 3, 4]);
});

test('a day with no accusations skips voting entirely and goes straight to night', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don']);
    $room->update(['status' => 'day', 'stage' => 'speaking', 'current_day' => 1, 'state' => ['speaking_order' => [1, 2, 3, 4], 'spoken_slots' => []]]);

    $engine = app(MafiaGameEngine::class);
    foreach (range(1, 4) as $_) {
        $engine->advance($room->fresh());
    }

    expect($room->fresh()->status)->toBe('night');
});

test('day 1 skips voting when exactly one player is nominated', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['status' => 'day', 'stage' => 'speaking', 'current_day' => 1, 'state' => ['speaking_order' => [1, 2, 3, 4], 'spoken_slots' => []]]);
    castVote($room, $players[1], $players[2], 'nominate');

    $engine = app(MafiaGameEngine::class);
    foreach (range(1, 4) as $_) {
        $engine->advance($room->fresh());
    }

    expect($room->fresh()->status)->toBe('night');
});

test('a lone nominee on day 2 or later still goes to a vote (the skip is day-1 only)', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['status' => 'day', 'stage' => 'speaking', 'current_day' => 2, 'state' => ['speaking_order' => [1, 2, 3, 4], 'spoken_slots' => []]]);
    castVote($room, $players[1], $players[2], 'nominate');

    $engine = app(MafiaGameEngine::class);
    foreach (range(1, 4) as $_) {
        $engine->advance($room->fresh());
    }

    expect($room->fresh()->stage)->toBe('voting');
});

test('a clear plurality vote eliminates the target after a last speech and moves on to night', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don', 5 => 'citizen']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update([
        'status' => 'day', 'stage' => 'voting', 'current_day' => 1,
        'state' => [
            'voting_candidates' => [$players[2]->id, $players[3]->id],
            'voting_queue' => [],
            'stage_started_at' => now()->subSecond()->toIso8601String(),
        ],
    ]);
    foreach ([1, 4, 5] as $voterSlot) {
        castVote($room, $players[$voterSlot], $players[3]);
    }
    castVote($room, $players[2], $players[2]);

    $engine = app(MafiaGameEngine::class);
    $engine->advance($room->fresh());
    $room->refresh();
    expect($room->stage)->toBe('last_speech');
    expect($room->dayState()['current_elimination'])->toBe($players[3]->id);

    $engine->advance($room->fresh());
    expect($players[3]->fresh()->status)->toBe('voted_out');
    expect($room->fresh()->status)->toBe('night');
});

test('a shrinking tie gets a defense speech and a re-vote among just the tied candidates', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update([
        'status' => 'day', 'stage' => 'voting', 'current_day' => 1,
        'state' => ['voting_candidates' => [$players[3]->id, $players[4]->id], 'voting_queue' => [], 'stage_started_at' => now()->subSecond()->toIso8601String()],
    ]);
    castVote($room, $players[1], $players[3]);
    castVote($room, $players[2], $players[3]);
    castVote($room, $players[3], $players[4]);
    castVote($room, $players[4], $players[4]);

    $engine = app(MafiaGameEngine::class);
    $engine->advance($room->fresh());
    $room->refresh();
    expect($room->stage)->toBe('defense_speech');
    expect($room->dayState()['defense_queue'])->toBe([$players[3]->id, $players[4]->id]);

    $engine->advance($room->fresh());
    expect($room->fresh()->stage)->toBe('defense_speech');

    $engine->advance($room->fresh());
    $room->refresh();
    expect($room->stage)->toBe('voting');
    expect($room->dayState()['voting_candidates'])->toBe([$players[3]->id, $players[4]->id]);

    foreach ([1, 2, 3, 4] as $voterSlot) {
        castVote($room, $players[$voterSlot], $players[3]);
    }
    // The re-vote's queue starts as the full 2-candidate list (unlike the
    // other tests here, which pre-seed an already-empty queue) — it needs
    // one advance() per candidate to drain before the tally resolves.
    $engine->advance($room->fresh());
    $engine->advance($room->fresh());
    $room->refresh();
    expect($room->stage)->toBe('last_speech');
    expect($room->dayState()['current_elimination'])->toBe($players[3]->id);
});

test('a persistent (non-shrinking) tie goes to the lock motion instead of another defense speech', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update([
        'status' => 'day', 'stage' => 'voting', 'current_day' => 1,
        'state' => [
            'voting_candidates' => [$players[3]->id, $players[4]->id],
            'voting_queue' => [],
            'stage_started_at' => now()->subSecond()->toIso8601String(),
            'previous_tie' => [$players[3]->id, $players[4]->id],
        ],
    ]);
    castVote($room, $players[1], $players[3]);
    castVote($room, $players[2], $players[4]);
    castVote($room, $players[3], $players[3]);
    castVote($room, $players[4], $players[4]);

    app(MafiaGameEngine::class)->advance($room->fresh());

    $room->refresh();
    expect($room->stage)->toBe('lock_vote');
    expect($room->dayState()['lock_vote_candidates'])->toBe([$players[3]->id, $players[4]->id]);
});

test('a passing lock motion eliminates every tied candidate one at a time via their own last speech', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'citizen', 4 => 'citizen', 5 => 'mafia']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update([
        'status' => 'day', 'stage' => 'lock_vote', 'current_day' => 1,
        'state' => ['lock_vote_candidates' => [$players[1]->id, $players[2]->id], 'stage_started_at' => now()->subSecond()->toIso8601String()],
    ]);
    foreach ([1, 2, 3] as $voterSlot) {
        castVote($room, $players[$voterSlot], $players[1], 'lock_vote');
    }

    $engine = app(MafiaGameEngine::class);
    $engine->advance($room->fresh());
    $room->refresh();
    expect($room->stage)->toBe('last_speech');
    expect($room->dayState()['current_elimination'])->toBe($players[1]->id);
    expect($room->dayState()['pending_eliminations'])->toBe([$players[2]->id]);

    $engine->advance($room->fresh());
    expect($players[1]->fresh()->status)->toBe('locked');
    $room->refresh();
    expect($room->stage)->toBe('last_speech');
    expect($room->dayState()['current_elimination'])->toBe($players[2]->id);

    $engine->advance($room->fresh());
    expect($players[2]->fresh()->status)->toBe('locked');
    expect($room->fresh()->status)->toBe('night');
});

test('a failing lock motion eliminates nobody and proceeds straight to night', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'citizen', 4 => 'citizen', 5 => 'mafia']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update([
        'status' => 'day', 'stage' => 'lock_vote', 'current_day' => 1,
        'state' => ['lock_vote_candidates' => [$players[1]->id, $players[2]->id], 'stage_started_at' => now()->subSecond()->toIso8601String()],
    ]);
    foreach ([1, 2] as $voterSlot) {
        castVote($room, $players[$voterSlot], $players[1], 'lock_vote');
    }

    app(MafiaGameEngine::class)->advance($room->fresh());

    expect($room->fresh()->status)->toBe('night');
    expect($players[1]->fresh()->status)->toBe('alive');
    expect($players[2]->fresh()->status)->toBe('alive');
});

test('a unanimous mafia shot kills the target and the night proceeds through both checks into the next morning', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don'], status: 'night');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['current_day' => 1]);

    $engine = app(MafiaGameEngine::class);
    $engine->advance($room->fresh());
    expect($room->fresh()->status)->toBe('shooting');

    foreach ([3, 4] as $shooterSlot) {
        castVote($room, $players[$shooterSlot], $players[1], 'shoot');
    }

    $engine->advance($room->fresh());
    expect($players[1]->fresh()->status)->toBe('killed');
    expect($room->fresh()->status)->toBe('don_check');

    $engine->advance($room->fresh());
    expect($room->fresh()->status)->toBe('sheriff_check');

    $engine->advance($room->fresh());
    $room->refresh();
    expect($room->status)->toBe('day');
    expect($room->current_day)->toBe(2);
    expect($room->stage)->toBe('morning_speech');
    expect($room->dayState()['current_elimination'])->toBe($players[1]->id);

    $engine->advance($room->fresh());
    $room->refresh();
    expect($room->stage)->toBe('speaking');
    expect($room->dayState()['speaking_order'])->toBe([2, 3, 4]);
});

test('day 2 discussion starts at slot 2 (not slot 1) and slot 1 speaks last, matching ttl10\'s rotating start-offset', function () {
    // 5 players (3 red, 2 black), not already at parity, per the same
    // reasoning as the "missing shooter" test below — a 2v2 room would
    // already satisfy the win check regardless of anything that happens.
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'citizen', 4 => 'mafia', 5 => 'don'], status: 'shooting');
    $room->update(['current_day' => 1, 'state' => ['stage_started_at' => now()->subSecond()->toIso8601String()]]);

    // No shots cast at all -> no kill -> day 2 opens with no victim,
    // straight into beginSpeakingOrder (no morning_speech detour).
    $engine = app(MafiaGameEngine::class);
    $engine->advance($room->fresh());
    expect($room->fresh()->status)->toBe('don_check');

    $engine->advance($room->fresh());
    expect($room->fresh()->status)->toBe('sheriff_check');

    $engine->advance($room->fresh());
    $room->refresh();
    expect($room->status)->toBe('day');
    expect($room->current_day)->toBe(2);
    expect($room->stage)->toBe('speaking');
    expect($room->dayState()['speaking_order'])->toBe([2, 3, 4, 5, 1]);
});

test('the mafia disagreeing on a target results in no kill', function () {
    // 5 red vs. 2 black (not already at parity) — a 4-player 2v2 room
    // would already satisfy the parity win condition before either
    // shooter even acts, which would make this test pass for the wrong
    // reason (any win check on it returns black regardless of the shot).
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'citizen', 4 => 'mafia', 5 => 'don'], status: 'shooting');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['current_day' => 1, 'state' => ['stage_started_at' => now()->subSecond()->toIso8601String()]]);
    castVote($room, $players[4], $players[1], 'shoot');
    castVote($room, $players[5], $players[2], 'shoot');

    app(MafiaGameEngine::class)->advance($room->fresh());

    expect($players[1]->fresh()->status)->toBe('alive');
    expect($players[2]->fresh()->status)->toBe('alive');
    expect($room->fresh()->status)->toBe('don_check');
});

test('a missing shooter results in no kill', function () {
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'citizen', 4 => 'mafia', 5 => 'don'], status: 'shooting');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['current_day' => 1, 'state' => ['stage_started_at' => now()->subSecond()->toIso8601String()]]);
    castVote($room, $players[4], $players[1], 'shoot');

    app(MafiaGameEngine::class)->advance($room->fresh());

    expect($players[1]->fresh()->status)->toBe('alive');
    expect($room->fresh()->status)->toBe('don_check');
});

test('the town wins immediately once the last mafia-team player is eliminated', function () {
    Event::fake([MafiaGameOver::class]);
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update([
        'status' => 'day', 'stage' => 'lock_vote', 'current_day' => 1,
        'state' => ['lock_vote_candidates' => [$players[3]->id], 'stage_started_at' => now()->subSecond()->toIso8601String()],
    ]);
    foreach ([1, 2] as $voterSlot) {
        castVote($room, $players[$voterSlot], $players[3], 'lock_vote');
    }

    $engine = app(MafiaGameEngine::class);
    $engine->advance($room->fresh());
    $engine->advance($room->fresh());

    $room->refresh();
    expect($room->status)->toBe('game_over');
    expect($room->winner_team)->toBe('red');
    Event::assertDispatched(MafiaGameOver::class);
});

test('the mafia wins immediately once a night kill brings them to parity', function () {
    Event::fake([MafiaGameOver::class]);
    $room = mafiaRoomWithRoles([1 => 'citizen', 2 => 'citizen', 3 => 'mafia'], status: 'shooting');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['current_day' => 1, 'state' => ['stage_started_at' => now()->subSecond()->toIso8601String()]]);
    castVote($room, $players[3], $players[1], 'shoot');

    app(MafiaGameEngine::class)->advance($room->fresh());

    $room->refresh();
    expect($room->status)->toBe('game_over');
    expect($room->winner_team)->toBe('black');
    Event::assertDispatched(MafiaGameOver::class);
});
