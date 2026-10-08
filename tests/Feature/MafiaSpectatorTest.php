<?php

use App\Events\Mafia\MafiaLobbyUpdated;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\MafiaSpectator;
use App\Models\User;
use Illuminate\Support\Facades\Event;

beforeEach(function () {
    config(['mafia.media_shared_secret' => 'test-shared-secret']);
});

function spectatorRoom(string $status = 'day', array $slotRoles = [1 => 'citizen', 2 => 'sheriff', 3 => 'mafia', 4 => 'don'], ?string $stage = 'speaking'): MafiaRoom
{
    $room = MafiaRoom::factory()->create([
        'status' => $status,
        'stage' => $status === 'day' ? $stage : null,
        'current_day' => 1,
        'state' => $status === 'day' ? ['speaking_order' => [1, 2, 3, 4], 'speech_total_ms' => 60000] : [],
    ]);

    foreach ($slotRoles as $slot => $role) {
        // No roles are dealt before the game starts.
        MafiaPlayer::factory()->create([
            'mafia_room_id' => $room->id,
            'user_id' => User::factory()->create()->id,
            'slot' => $slot,
            'role' => $status === 'lobby' ? null : $role,
            'joined_at' => now()->addSeconds($slot),
        ]);
    }

    return $room->fresh();
}

function decodeSpectatorToken(string $token): array
{
    [$payloadB64] = explode('.', $token);

    return json_decode(base64_decode(strtr($payloadB64, '-_', '+/')), true);
}

// ---- opening the link --------------------------------------------------

test('a guest opening the link of a running game is taken to the watch page', function () {
    $room = spectatorRoom('day');

    $this->get("/mafia/{$room->room_code}")->assertRedirect(route('mafia.watch', $room->room_code));
});

test('a guest can watch a running game, and sees no roles, checks or private data', function () {
    $room = spectatorRoom('day');

    $page = $this->get("/mafia/{$room->room_code}/watch")->assertOk();
    $snapshot = $page->viewData('page')['props']['snapshot'];

    expect($page->viewData('page')['component'])->toBe('Mafia/Play');
    expect($page->viewData('page')['props']['spectator'])->toBeTrue();
    expect($snapshot['isSpectator'])->toBeTrue();
    expect(collect($snapshot['seats'])->pluck('role')->filter()->all())->toBe([]);
    expect($snapshot['seats'])->toHaveCount(4);
    expect(collect($snapshot['seats'])->pluck('isYou')->filter()->all())->toBe([]);
    expect($snapshot['you']['role'])->toBeNull();
    expect($snapshot['mafiaTeammates'])->toBe([]);
    expect($snapshot['donCheckHistory'])->toBe([]);
    expect($snapshot['sheriffCheckHistory'])->toBe([]);
    expect($snapshot['disconnectedPlayers'])->toBe([]);
    foreach (['canNominate', 'canVote', 'canShoot', 'canDonCheck', 'canSheriffCheck', 'canPass', 'canShoutOut', 'canLockVote'] as $flag) {
        expect($snapshot[$flag])->toBeFalse();
    }
});

test('roles are revealed to spectators once the game is over', function () {
    $room = spectatorRoom('game_over');

    $snapshot = $this->get("/mafia/{$room->room_code}/watch")->viewData('page')['props']['snapshot'];

    expect(collect($snapshot['seats'])->pluck('role')->all())->toBe(['citizen', 'sheriff', 'mafia', 'don']);
});

test('a guest can watch a lobby without taking a seat', function () {
    $room = spectatorRoom('lobby');

    $page = $this->get("/mafia/{$room->room_code}/watch")->assertOk();
    $props = $page->viewData('page')['props'];

    expect($page->viewData('page')['component'])->toBe('Mafia/Lobby');
    expect($props['spectator'])->toBeTrue();
    expect($props['canTakeSeat'])->toBeFalse();
    expect($props['snapshot']['players'])->toHaveCount(4);
});

test('a signed-in user facing a lobby with free seats still gets the join choice, with a watch option', function () {
    $room = spectatorRoom('lobby');
    $user = User::factory()->create();

    $props = $this->actingAs($user)->get("/mafia/{$room->room_code}")->assertOk()->viewData('page')['props'];

    expect($props['state'])->toBe('joinable');
    expect($props['watchUrl'])->toBe(route('mafia.watch', $room->room_code));
});

test('a signed-in user who cannot join is sent to watch instead of a dead end', function () {
    $started = spectatorRoom('day');
    $user = User::factory()->create();

    $this->actingAs($user)->get("/mafia/{$started->room_code}")->assertRedirect(route('mafia.watch', $started->room_code));
});

test('a cancelled room is still a dead end, and an unknown code says so', function () {
    $room = spectatorRoom('lobby');
    $room->update(['status' => 'cancelled']);

    expect($this->get("/mafia/{$room->room_code}")->viewData('page')['props']['state'])->toBe('cancelled');
    expect($this->get('/mafia/NOPE99')->viewData('page')['props']['state'])->toBe('not_found');
    $this->get('/mafia/NOPE99/watch')->assertNotFound();
});

test('a seated player is sent to their own page, not the watch page', function () {
    $room = spectatorRoom('day');
    $player = $room->players()->first();

    $this->actingAs($player->user)->get("/mafia/{$room->room_code}/watch")->assertRedirect(route('mafia.play', $room->room_code));
});

// ---- who is watching ---------------------------------------------------

test('watchers are listed: a guest as a guest, a signed-in user by name', function () {
    $room = spectatorRoom('day');
    $viewer = User::factory()->create(['name' => 'Vera Viewer']);

    $this->get("/mafia/{$room->room_code}/watch")->assertOk();
    auth()->logout();
    $this->actingAs($viewer)->get("/mafia/{$room->room_code}/watch")->assertOk();

    $list = collect($room->fresh()->spectatorList());
    expect($list)->toHaveCount(2);
    expect($list->firstWhere('isGuest', true)['name'])->toBeNull();
    expect($list->firstWhere('isGuest', false)['name'])->toBe('Vera Viewer');
});

test('the same viewer reloading is one watcher, not many', function () {
    $room = spectatorRoom('day');

    $this->get("/mafia/{$room->room_code}/watch");
    $this->get("/mafia/{$room->room_code}/watch");
    $this->get("/mafia/{$room->room_code}/watch/state");

    expect($room->spectators()->count())->toBe(1);
});

test('people who stopped checking in drop off the list', function () {
    $room = spectatorRoom('day');
    $room->spectators()->create(['session_token' => 'old', 'last_seen_at' => now()->subMinutes(5)]);
    $room->spectators()->create(['session_token' => 'fresh', 'last_seen_at' => now()]);

    expect($room->spectatorList())->toHaveCount(1);
});

test('at most 20 watchers per room; stale ones do not count', function () {
    $room = spectatorRoom('day');
    foreach (range(1, 20) as $i) {
        $room->spectators()->create(['session_token' => "tok{$i}", 'last_seen_at' => now()]);
    }

    $this->get("/mafia/{$room->room_code}/watch")->assertStatus(429);

    $room->spectators()->first()->update(['last_seen_at' => now()->subMinutes(10)]);
    $this->get("/mafia/{$room->room_code}/watch")->assertOk();
});

test('a new watcher is announced to the lobby', function () {
    Event::fake([MafiaLobbyUpdated::class]);
    $room = spectatorRoom('lobby');

    $this->get("/mafia/{$room->room_code}/watch");

    Event::assertDispatched(MafiaLobbyUpdated::class);
});

// ---- state and media ---------------------------------------------------

test('the watch state endpoint serves the lobby payload in a lobby and the public snapshot in a game', function () {
    $lobby = spectatorRoom('lobby');
    $json = $this->getJson("/mafia/{$lobby->room_code}/watch/state")->assertOk()->json();
    expect($json['status'])->toBe('lobby');
    expect($json)->toHaveKeys(['players', 'spectators']);

    $game = spectatorRoom('day');
    $json = $this->getJson("/mafia/{$game->room_code}/watch/state")->assertOk()->json();
    expect($json['isSpectator'])->toBeTrue();
    expect($json['you']['status'])->toBe('spectator');
});

test('a spectator can get a media token that identifies them as a spectator', function () {
    $room = spectatorRoom('day');

    $response = $this->getJson("/mafia/{$room->room_code}/watch/media-token")->assertOk();
    $payload = decodeSpectatorToken($response->json('token'));

    expect($payload['role'])->toBe('spectator');
    expect($payload['playerId'])->toBe('s'.$room->spectators()->first()->id);
    expect($payload['roomCode'])->toBe($room->room_code);
});

test('who may a spectator see and hear: lobby and game over everyone, the day only the living, never at night', function () {
    $room = spectatorRoom('day');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[2]->update(['status' => 'killed']);
    $this->getJson("/mafia/{$room->room_code}/watch/state");
    $spectator = $room->spectators()->firstOrFail();

    $can = fn ($target) => $this->getJson('/internal/mafia/can-view?room='.$room->room_code.'&viewer='.$spectator->mediaId().'&target='.$target->id, ['X-Media-Sfu-Secret' => 'test-shared-secret'])->json('canView');

    expect($can($players[1]))->toBeTrue();   // day, alive
    expect($can($players[2]))->toBeFalse();  // day, killed

    foreach (['sitdown', 'don_watch', 'sheriff_watch', 'night', 'shooting', 'don_check', 'sheriff_check'] as $status) {
        $room->update(['status' => $status, 'stage' => null]);
        expect($can($players[1]))->toBeFalse();
    }

    foreach (['game_over', 'lobby'] as $status) {
        $room->update(['status' => $status]);
        expect($can($players[1]))->toBeTrue();
        expect($can($players[2]))->toBeTrue();
    }
});

test('a spectator id from another room, or an unknown one, can never view', function () {
    $room = spectatorRoom('day');
    $other = spectatorRoom('day');
    $this->getJson("/mafia/{$other->room_code}/watch/state");
    $foreign = $other->spectators()->firstOrFail();
    $target = $room->players()->first();

    $result = $this->getJson('/internal/mafia/can-view?room='.$room->room_code.'&viewer='.$foreign->mediaId().'&target='.$target->id, ['X-Media-Sfu-Secret' => 'test-shared-secret'])->json('canView');

    expect($result)->toBeFalse();
});

// ---- players cannot be spoofed by spectators ---------------------------

test('a signed-in spectator cannot act as a player', function () {
    $room = spectatorRoom('day');
    $viewer = User::factory()->create();
    $target = $room->players()->first();

    $this->actingAs($viewer)->post("/mafia/{$room->room_code}/nominate", ['target_player_id' => $target->id])->assertForbidden();
    $this->actingAs($viewer)->post("/mafia/{$room->room_code}/shout-out")->assertForbidden();
    $this->actingAs($viewer)->post("/mafia/{$room->room_code}/ready")->assertForbidden();
});

// ---- taking a seat from the audience -----------------------------------

test('a signed-in spectator can take a chosen free seat in the lobby and stops being a spectator', function () {
    $room = spectatorRoom('lobby', [1 => 'citizen', 2 => 'citizen']);
    $viewer = User::factory()->create();
    $this->actingAs($viewer)->get("/mafia/{$room->room_code}/watch");
    expect($room->spectators()->count())->toBe(1);

    $this->actingAs($viewer)->post("/mafia/{$room->room_code}/join", ['slot' => 7])->assertRedirect(route('mafia.lobby', $room->room_code));

    expect($room->players()->where('user_id', $viewer->id)->first()->slot)->toBe(7);
    expect($room->spectators()->count())->toBe(0);
});

test('a taken seat cannot be chosen', function () {
    $room = spectatorRoom('lobby', [1 => 'citizen', 2 => 'citizen']);
    $viewer = User::factory()->create();

    $this->actingAs($viewer)->post("/mafia/{$room->room_code}/join", ['slot' => 2])->assertSessionHasErrors('slot');

    expect($room->players()->where('user_id', $viewer->id)->exists())->toBeFalse();
});

test('joining without naming a seat still takes the first free one', function () {
    $room = spectatorRoom('lobby', [1 => 'citizen', 2 => 'citizen']);
    $viewer = User::factory()->create();

    $this->actingAs($viewer)->post("/mafia/{$room->room_code}/join");

    expect($room->players()->where('user_id', $viewer->id)->first()->slot)->toBe(3);
});

// ---- giving up a seat --------------------------------------------------

test('a player can release their seat and keep watching the lobby', function () {
    $room = spectatorRoom('lobby', [1 => 'citizen', 2 => 'citizen', 3 => 'citizen']);
    $leaver = $room->players()->where('slot', 3)->first();

    $this->actingAs($leaver->user)->post("/mafia/{$room->room_code}/release-seat")->assertRedirect(route('mafia.watch', $room->room_code));

    expect($room->players()->count())->toBe(2);
    expect($room->players()->where('user_id', $leaver->user_id)->exists())->toBeFalse();
    expect($room->spectators()->where('user_id', $leaver->user_id)->exists())->toBeTrue();
});

test('the game-host role moves to the longest-seated remaining player when the host releases their seat', function () {
    $room = spectatorRoom('lobby', [1 => 'citizen', 2 => 'citizen', 3 => 'citizen']);
    $host = $room->players()->where('slot', 1)->first();
    $host->update(['is_game_host' => true]);

    $this->actingAs($host->user)->post("/mafia/{$room->room_code}/release-seat");

    expect($room->players()->where('is_game_host', true)->count())->toBe(1);
    expect($room->players()->where('is_game_host', true)->first()->slot)->toBe(2);
});

test('a lone player cannot release their seat — there is nobody to hand the room to', function () {
    $room = spectatorRoom('lobby', [1 => 'citizen']);
    $host = $room->players()->first();
    $host->update(['is_game_host' => true]);

    $this->actingAs($host->user)->post("/mafia/{$room->room_code}/release-seat")->assertRedirect(route('mafia.lobby', $room->room_code));

    expect($room->players()->count())->toBe(1);
});

test('releasing a seat can be what lets the game start, when everyone left is ready', function () {
    $room = spectatorRoom('lobby', [1 => 'citizen', 2 => 'citizen', 3 => 'citizen']);
    $room->players()->whereIn('slot', [1, 2])->update(['is_ready' => true]);
    $leaver = $room->players()->where('slot', 3)->first();

    $this->actingAs($leaver->user)->post("/mafia/{$room->room_code}/release-seat");

    expect($room->fresh()->status)->toBe('sitdown');
});

test('seats cannot be released once the game has started', function () {
    $room = spectatorRoom('day');
    $player = $room->players()->first();

    $this->actingAs($player->user)->post("/mafia/{$room->room_code}/release-seat")->assertRedirect(route('mafia.play', $room->room_code));

    expect($room->players()->count())->toBe(4);
});

// ---- room-wide visibility (what the sidecar polls) -----------------------

test('the visibility endpoint answers for a whole room at once, players and spectators alike', function () {
    $room = spectatorRoom('day');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $players[2]->update(['status' => 'killed']);
    $this->getJson("/mafia/{$room->room_code}/watch/state");
    $spectator = $room->spectators()->firstOrFail();

    $viewers = implode(',', [$players[1]->id, $spectator->mediaId(), 'sNOPE', 99999]);
    $response = $this->getJson("/internal/mafia/visibility?room={$room->room_code}&viewers={$viewers}", ['X-Media-Sfu-Secret' => 'test-shared-secret'])->assertOk()->json();

    // Day: a living player and a spectator see the living (not the killed one, not themselves).
    expect($response[(string) $players[1]->id])->toEqualCanonicalizing([$players[3]->id, $players[4]->id]);
    expect($response[$spectator->mediaId()])->toEqualCanonicalizing([$players[1]->id, $players[3]->id, $players[4]->id]);
    // Unknown viewers fail closed.
    expect($response['sNOPE'])->toBe([]);
    expect($response['99999'])->toBe([]);
});

test('at night nobody outside the mafia sees anybody, and the endpoint needs the shared secret', function () {
    $room = spectatorRoom('night');
    $players = $room->players()->orderBy('slot')->get()->keyBy('slot');
    $this->getJson("/mafia/{$room->room_code}/watch/state");
    $spectator = $room->spectators()->firstOrFail();

    $this->getJson("/internal/mafia/visibility?room={$room->room_code}&viewers=1")->assertForbidden();

    $viewers = implode(',', [$players[1]->id, $players[3]->id, $spectator->mediaId()]);
    $response = $this->getJson("/internal/mafia/visibility?room={$room->room_code}&viewers={$viewers}", ['X-Media-Sfu-Secret' => 'test-shared-secret'])->json();

    expect($response[(string) $players[1]->id])->toBe([]);                       // citizen
    expect($response[$spectator->mediaId()])->toBe([]);                          // spectator
    expect($response[(string) $players[3]->id])->toBe([$players[4]->id]);        // mafia sees the don
});
