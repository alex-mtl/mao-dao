<?php

use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\User;

beforeEach(function () {
    config(['mafia.media_shared_secret' => 'test-shared-secret']);
});

function mediaRoomWithPlayers(array $slotRoles, string $status = 'day'): MafiaRoom
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

function decodeMediaToken(string $token): array
{
    [$payloadB64] = explode('.', $token);

    return json_decode(base64_decode(strtr($payloadB64, '-_', '+/')), true);
}

test('a seated player can fetch a signed media token', function () {
    $room = mediaRoomWithPlayers([1 => 'citizen']);
    $player = $room->players()->first();

    $response = $this->actingAs($player->user)->get("/mafia/{$room->room_code}/media-token");

    $response->assertOk();
    $response->assertJsonStructure(['token', 'wsUrl']);

    $payload = decodeMediaToken($response->json('token'));
    expect($payload['roomCode'])->toBe($room->room_code);
    expect($payload['playerId'])->toBe($player->id);
    expect($payload['slot'])->toBe($player->slot);
});

test('the media token signature verifies against the shared secret', function () {
    $room = mediaRoomWithPlayers([1 => 'citizen']);
    $player = $room->players()->first();

    $token = $this->actingAs($player->user)->get("/mafia/{$room->room_code}/media-token")->json('token');
    [$payloadB64, $signature] = explode('.', $token);

    $expected = hash_hmac('sha256', $payloadB64, 'test-shared-secret');
    expect($signature)->toBe($expected);
});

test('requesting a media token fails loudly if voice/video is not configured', function () {
    config(['mafia.media_shared_secret' => null]);
    $room = mediaRoomWithPlayers([1 => 'citizen']);
    $player = $room->players()->first();

    $response = $this->actingAs($player->user)->get("/mafia/{$room->room_code}/media-token");

    $response->assertServerError();
});

test('the internal can-view endpoint rejects a request without the correct shared secret', function () {
    $room = mediaRoomWithPlayers([1 => 'mafia', 2 => 'don']);
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $response = $this->get("/internal/mafia/can-view?room={$room->room_code}&viewer={$players[1]->id}&target={$players[2]->id}", [
        'X-Media-Sfu-Secret' => 'wrong-secret',
    ]);

    $response->assertForbidden();
});

test('the internal can-view endpoint reflects MafiaRoom::canPlayerView', function () {
    $room = mediaRoomWithPlayers([1 => 'mafia', 2 => 'don', 3 => 'citizen'], status: 'sitdown');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $mafiaToMafia = $this->get("/internal/mafia/can-view?room={$room->room_code}&viewer={$players[1]->id}&target={$players[2]->id}", [
        'X-Media-Sfu-Secret' => 'test-shared-secret',
    ]);
    $mafiaToMafia->assertOk()->assertJson(['canView' => true]);

    $mafiaToCitizen = $this->get("/internal/mafia/can-view?room={$room->room_code}&viewer={$players[1]->id}&target={$players[3]->id}", [
        'X-Media-Sfu-Secret' => 'test-shared-secret',
    ]);
    $mafiaToCitizen->assertOk()->assertJson(['canView' => false]);
});

test('canPlayerView allows anyone alive to see anyone alive during the day', function () {
    $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'sheriff'], status: 'day');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    expect($room->canPlayerView($players[1], $players[2]))->toBeTrue();
    expect($room->canPlayerView($players[2], $players[1]))->toBeTrue();
});

test('canPlayerView hides everyone during the private watch and check phases', function () {
    $room = mediaRoomWithPlayers([1 => 'mafia', 2 => 'don'], status: 'don_watch');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    expect($room->canPlayerView($players[1], $players[2]))->toBeFalse();

    $room->update(['status' => 'sheriff_check']);
    expect($room->fresh()->canPlayerView($players[1], $players[2]))->toBeFalse();
});

test('canPlayerView never allows viewing a dead player mid-game, or viewing oneself ever', function () {
    $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'citizen'], status: 'day');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[2]->update(['status' => 'killed']);

    expect($room->canPlayerView($players[1], $players[1]))->toBeFalse();
    expect($room->canPlayerView($players[1], $players[2]->fresh()))->toBeFalse();
});

test('canPlayerView reunites the whole table, alive or dead, once the game is over', function () {
    // The one deliberate exception to the "dead players are never
    // viewable" rule above — once the result is announced, every camera
    // is forced back on (Play.jsx's auto-connect effect) so the group can
    // keep talking together, eliminated players included.
    $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'mafia', 3 => 'sheriff'], status: 'game_over');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[1]->update(['status' => 'killed']);
    $players[2]->update(['status' => 'voted_out']);

    expect($room->canPlayerView($players[3], $players[1]->fresh()))->toBeTrue();
    expect($room->canPlayerView($players[1]->fresh(), $players[2]->fresh()))->toBeTrue();
    expect($room->canPlayerView($players[1]->fresh(), $players[1]->fresh()))->toBeFalse();
});

test('canPlayerView lets everyone seated see each other in the lobby, before any roles exist', function () {
    $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'mafia'], status: 'lobby');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->players()->update(['role' => null]);

    expect($room->fresh()->canPlayerView($players[1]->fresh(), $players[2]->fresh()))->toBeTrue();
    expect($room->fresh()->canPlayerView($players[2]->fresh(), $players[1]->fresh()))->toBeTrue();
    expect($room->fresh()->canPlayerView($players[1]->fresh(), $players[1]->fresh()))->toBeFalse();
});

test('micPolicy: everyone may talk in the lobby and after the game', function () {
    foreach (['lobby', 'game_over'] as $status) {
        $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'mafia'], status: $status);

        expect($room->micPolicy())->toBe(['mode' => 'all', 'playerIds' => []]);
    }
});

test('micPolicy: during the day only the current speaker may be heard', function () {
    $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], status: 'day');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $room->update(['stage' => 'speaking', 'state' => ['speaking_order' => [2, 3, 1], 'spoken_slots' => []]]);

    expect($room->fresh()->micPolicy())->toBe(['mode' => 'only', 'playerIds' => [$players[2]->id]]);

    $room->update(['state' => ['speaking_order' => [3, 1], 'spoken_slots' => [2]]]);
    expect($room->fresh()->micPolicy())->toBe(['mode' => 'only', 'playerIds' => [$players[3]->id]]);
});

test('micPolicy: a last word and a defense speech belong to one player each', function () {
    $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia'], status: 'day');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');

    $room->update(['stage' => 'last_speech', 'state' => ['current_elimination' => $players[1]->id]]);
    expect($room->fresh()->micPolicy())->toBe(['mode' => 'only', 'playerIds' => [$players[1]->id]]);

    $room->update(['stage' => 'morning_speech', 'state' => ['current_elimination' => $players[3]->id]]);
    expect($room->fresh()->micPolicy())->toBe(['mode' => 'only', 'playerIds' => [$players[3]->id]]);

    $room->update(['stage' => 'defense_speech', 'state' => ['defense_queue' => [$players[2]->id, $players[3]->id]]]);
    expect($room->fresh()->micPolicy())->toBe(['mode' => 'only', 'playerIds' => [$players[2]->id]]);
});

test('micPolicy: nobody talks while voting, at night, or during the private reveals', function () {
    $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'mafia'], status: 'day');
    $room->update(['stage' => 'voting', 'state' => ['voting_candidates' => [1]]]);
    expect($room->fresh()->micPolicy()['mode'])->toBe('none');

    foreach (['sitdown', 'don_watch', 'sheriff_watch', 'night', 'shooting', 'don_check', 'sheriff_check'] as $status) {
        $room->update(['status' => $status, 'stage' => null, 'state' => []]);
        expect($room->fresh()->micPolicy())->toBe(['mode' => 'none', 'playerIds' => []]);
    }
});

test('the internal mic-policy endpoint needs the shared secret and answers per room', function () {
    $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'mafia'], status: 'lobby');

    $this->getJson("/internal/mafia/mic-policy?room={$room->room_code}")->assertForbidden();
    $this->getJson("/internal/mafia/mic-policy?room={$room->room_code}", ['X-Media-Sfu-Secret' => 'wrong'])->assertForbidden();

    $this->getJson("/internal/mafia/mic-policy?room={$room->room_code}", ['X-Media-Sfu-Secret' => 'test-shared-secret'])
        ->assertOk()->assertJson(['mode' => 'all']);

    $this->getJson('/internal/mafia/mic-policy?room=NOPE99', ['X-Media-Sfu-Secret' => 'test-shared-secret'])
        ->assertOk()->assertJson(['mode' => 'none']);
});

test('the sidecar is nudged after a phase change, and a dead sidecar never breaks the game', function () {
    config(['mafia.media_internal_url' => 'http://sidecar.test']);
    \Illuminate\Support\Facades\Http::fake(['sidecar.test/*' => \Illuminate\Support\Facades\Http::response('', 202)]);

    $room = mediaRoomWithPlayers([1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don'], status: 'sitdown');
    app(\App\Services\Mafia\MafiaGameEngine::class)->advance($room->fresh());

    \Illuminate\Support\Facades\Http::assertSent(fn ($request) => str_ends_with($request->url(), '/internal/refresh-mics')
        && $request['room'] === $room->room_code
        && $request->hasHeader('X-Media-Sfu-Secret', 'test-shared-secret'));

    \Illuminate\Support\Facades\Http::fake(fn () => throw new \Illuminate\Http\Client\ConnectionException('down'));
    app(\App\Services\Mafia\MafiaGameEngine::class)->advance($room->fresh());

    expect($room->fresh()->status)->toBe('sheriff_watch');
});
