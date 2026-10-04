<?php

use App\Events\Mafia\MafiaActionRecorded;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\User;
use Illuminate\Support\Facades\Event;

/**
 * Reported directly: nominate/vote/lock-vote/shoot/checks/disconnect-votes
 * only used to record silently — nobody else found out until the next
 * phase-transition broadcast or the 12s heartbeat poll happened to land.
 * MafiaActionRecorded now fires from the one shared choke point,
 * MafiaController::recordAction(), so every action type gets it for free.
 * These tests just confirm the dispatch happens on a representative
 * sample — the actual action-recording logic itself is already covered
 * by MafiaGameplayTest.php.
 */
function actionRoomWithPlayers(array $slotRoles, string $status = 'day', ?string $stage = null, array $state = []): MafiaRoom
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

test('nominating broadcasts MafiaActionRecorded', function () {
    Event::fake([MafiaActionRecorded::class]);
    $room = actionRoomWithPlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'speaking', state: ['speaking_order' => [1]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $players[2]->id]);

    Event::assertDispatched(MafiaActionRecorded::class, fn ($event) => $event->room->id === $room->id);
});

test('voting broadcasts MafiaActionRecorded', function () {
    Event::fake([MafiaActionRecorded::class]);
    $room = actionRoomWithPlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'voting');
    $room->update(['state' => ['voting_candidates' => [$room->players()->where('slot', 2)->first()->id], 'voting_queue' => []]]);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/vote", ['candidate_player_id' => $players[2]->id]);

    Event::assertDispatched(MafiaActionRecorded::class, fn ($event) => $event->room->id === $room->id);
});

test('an action that is silently rejected does not broadcast anything', function () {
    Event::fake([MafiaActionRecorded::class]);
    $room = actionRoomWithPlayers([1 => 'citizen', 2 => 'sheriff'], stage: 'voting');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    // No voting_candidates configured — this vote is a no-op.
    $this->actingAs($players[1]->user)->post("/mafia/{$room->room_code}/vote", ['candidate_player_id' => $players[2]->id]);

    Event::assertNotDispatched(MafiaActionRecorded::class);
});
