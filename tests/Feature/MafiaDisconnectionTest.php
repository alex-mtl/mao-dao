<?php

use App\Events\Mafia\MafiaGameOver;
use App\Events\Mafia\MafiaPlayerConnectionChanged;
use App\Models\MafiaAction;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\User;
use App\Services\Mafia\MafiaGameEngine;
use Illuminate\Support\Facades\Event;

function disconnectRoomWithRoles(array $slotRoles, string $status = 'day'): MafiaRoom
{
    $room = MafiaRoom::factory()->create(['status' => $status, 'current_day' => 1]);

    foreach ($slotRoles as $slot => $role) {
        MafiaPlayer::factory()->role($role)->create([
            'mafia_room_id' => $room->id,
            'user_id' => User::factory()->create()->id,
            'slot' => $slot,
        ]);
    }

    return $room->fresh();
}

test('a connected player whose heartbeat has gone stale is flagged disconnected', function () {
    Event::fake([MafiaPlayerConnectionChanged::class]);
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['last_seen_at' => now()->subSeconds(config('mafia.player_disconnect_timeout_seconds') + 5)]);

    app(MafiaGameEngine::class)->flagDisconnectedPlayers();

    $players[1]->refresh();
    expect($players[1]->connection_status)->toBe('disconnected');
    expect($players[1]->disconnected_at)->not->toBeNull();
    Event::assertDispatched(MafiaPlayerConnectionChanged::class);
});

test('a recently-seen player is not flagged disconnected', function () {
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['last_seen_at' => now()]);

    app(MafiaGameEngine::class)->flagDisconnectedPlayers();

    expect($players[1]->fresh()->connection_status)->toBe('connected');
});

test('a dummy seat is never flagged disconnected regardless of its stale heartbeat', function () {
    $room = disconnectRoomWithRoles([1 => 'citizen']);
    $dummy = MafiaPlayer::factory()->dummy()->role('sheriff')->create([
        'mafia_room_id' => $room->id, 'slot' => 2,
        'last_seen_at' => now()->subSeconds(config('mafia.player_disconnect_timeout_seconds') + 5),
    ]);

    app(MafiaGameEngine::class)->flagDisconnectedPlayers();

    expect($dummy->fresh()->connection_status)->toBe('connected');
});

test('a lobby room is never touched by disconnect flagging', function () {
    $room = MafiaRoom::factory()->create(['status' => 'lobby']);
    $player = $room->players()->create([
        'user_id' => User::factory()->create()->id, 'slot' => 1, 'is_game_host' => true,
        'joined_at' => now(), 'last_seen_at' => now()->subSeconds(config('mafia.player_disconnect_timeout_seconds') + 5),
    ]);

    app(MafiaGameEngine::class)->flagDisconnectedPlayers();

    expect($player->fresh()->connection_status)->toBe('connected');
});

test('a disconnected player is eliminated once every other real player votes to eliminate them', function () {
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'citizen']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['connection_status' => 'disconnected', 'disconnected_at' => now()->subSecond()]);

    foreach ([2, 3] as $voterSlot) {
        MafiaAction::create([
            'mafia_room_id' => $room->id, 'day' => 1, 'phase' => 'disconnect',
            'actor_player_id' => $players[$voterSlot]->id, 'target_player_id' => $players[1]->id,
            'action_type' => 'disconnect_eliminate',
        ]);
    }

    app(MafiaGameEngine::class)->resolveDisconnectVotes();

    expect($players[1]->fresh()->status)->toBe('disconnect_eliminated');
});

test('a disconnected player is kept once every other real player votes to continue, and their window resets', function () {
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'citizen']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $originalDisconnectedAt = now()->subMinute();
    $players[1]->update(['connection_status' => 'disconnected', 'disconnected_at' => $originalDisconnectedAt]);

    foreach ([2, 3] as $voterSlot) {
        MafiaAction::create([
            'mafia_room_id' => $room->id, 'day' => 1, 'phase' => 'disconnect',
            'actor_player_id' => $players[$voterSlot]->id, 'target_player_id' => $players[1]->id,
            'action_type' => 'disconnect_continue',
        ]);
    }

    app(MafiaGameEngine::class)->resolveDisconnectVotes();

    $players[1]->refresh();
    expect($players[1]->status)->toBe('alive');
    expect($players[1]->connection_status)->toBe('disconnected');
    expect($players[1]->disconnected_at->isAfter($originalDisconnectedAt))->toBeTrue();
});

test('a disconnect vote does not resolve until every other real player has voted', function () {
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'citizen']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['connection_status' => 'disconnected', 'disconnected_at' => now()->subSecond()]);

    MafiaAction::create([
        'mafia_room_id' => $room->id, 'day' => 1, 'phase' => 'disconnect',
        'actor_player_id' => $players[2]->id, 'target_player_id' => $players[1]->id,
        'action_type' => 'disconnect_eliminate',
    ]);

    app(MafiaGameEngine::class)->resolveDisconnectVotes();

    expect($players[1]->fresh()->status)->toBe('alive');
    expect($players[1]->fresh()->connection_status)->toBe('disconnected');
});

test('a split vote resolves neither way', function () {
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff', 3 => 'citizen']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['connection_status' => 'disconnected', 'disconnected_at' => now()->subSecond()]);

    MafiaAction::create([
        'mafia_room_id' => $room->id, 'day' => 1, 'phase' => 'disconnect',
        'actor_player_id' => $players[2]->id, 'target_player_id' => $players[1]->id,
        'action_type' => 'disconnect_eliminate',
    ]);
    MafiaAction::create([
        'mafia_room_id' => $room->id, 'day' => 1, 'phase' => 'disconnect',
        'actor_player_id' => $players[3]->id, 'target_player_id' => $players[1]->id,
        'action_type' => 'disconnect_continue',
    ]);

    app(MafiaGameEngine::class)->resolveDisconnectVotes();

    expect($players[1]->fresh()->status)->toBe('alive');
});

test('dummy seats are excluded from the unanimity requirement so the vote can still resolve', function () {
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    MafiaPlayer::factory()->dummy()->role('citizen')->create(['mafia_room_id' => $room->id, 'slot' => 3]);
    $players[1]->update(['connection_status' => 'disconnected', 'disconnected_at' => now()->subSecond()]);

    // Only the one other REAL player (slot 2) needs to vote — the dummy
    // at slot 3 never will, and must not block resolution.
    MafiaAction::create([
        'mafia_room_id' => $room->id, 'day' => 1, 'phase' => 'disconnect',
        'actor_player_id' => $players[2]->id, 'target_player_id' => $players[1]->id,
        'action_type' => 'disconnect_eliminate',
    ]);

    app(MafiaGameEngine::class)->resolveDisconnectVotes();

    expect($players[1]->fresh()->status)->toBe('disconnect_eliminated');
});

test('eliminating a disconnected player can immediately end the game', function () {
    Event::fake([MafiaGameOver::class]);
    $room = disconnectRoomWithRoles([1 => 'mafia', 2 => 'citizen', 3 => 'citizen']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['connection_status' => 'disconnected', 'disconnected_at' => now()->subSecond()]);

    foreach ([2, 3] as $voterSlot) {
        MafiaAction::create([
            'mafia_room_id' => $room->id, 'day' => 1, 'phase' => 'disconnect',
            'actor_player_id' => $players[$voterSlot]->id, 'target_player_id' => $players[1]->id,
            'action_type' => 'disconnect_eliminate',
        ]);
    }

    app(MafiaGameEngine::class)->resolveDisconnectVotes();

    $room->refresh();
    expect($room->status)->toBe('game_over');
    expect($room->winner_team)->toBe('red');
    Event::assertDispatched(MafiaGameOver::class);
});

test('the controller rejects a disconnect vote against a player who is not actually disconnected', function () {
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $this->actingAs($players[2]->user)->post("/mafia/{$room->room_code}/disconnect-vote", [
        'target_player_id' => $players[1]->id, 'choice' => 'eliminate',
    ]);

    expect(MafiaAction::where('action_type', 'disconnect_eliminate')->count())->toBe(0);
});

test('the controller records a legitimate disconnect vote', function () {
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['connection_status' => 'disconnected', 'disconnected_at' => now()]);

    $this->actingAs($players[2]->user)->post("/mafia/{$room->room_code}/disconnect-vote", [
        'target_player_id' => $players[1]->id, 'choice' => 'continue',
    ]);

    expect(MafiaAction::where('action_type', 'disconnect_continue')
        ->where('actor_player_id', $players[2]->id)
        ->where('target_player_id', $players[1]->id)
        ->exists())->toBeTrue();
});

test('a request from a flagged-disconnected player reconnects them and broadcasts the change', function () {
    Event::fake([MafiaPlayerConnectionChanged::class]);
    $room = disconnectRoomWithRoles([1 => 'citizen', 2 => 'sheriff']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['connection_status' => 'disconnected', 'disconnected_at' => now()->subMinute()]);

    $this->actingAs($players[1]->user)->get("/mafia/{$room->room_code}/play");

    $players[1]->refresh();
    expect($players[1]->connection_status)->toBe('connected');
    expect($players[1]->disconnected_at)->toBeNull();
    Event::assertDispatched(MafiaPlayerConnectionChanged::class);
});
