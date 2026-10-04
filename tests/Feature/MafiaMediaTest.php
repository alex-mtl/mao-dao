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
