<?php

use App\Events\Mafia\MafiaGameStarting;
use App\Events\Mafia\MafiaLobbyUpdated;
use App\Events\Mafia\MafiaRoomCancelled;
use App\Models\MafiaRoom;
use App\Models\User;
use Illuminate\Support\Facades\Event;

test('creating a room seats its creator as the game-host in slot 1', function () {
    $host = User::factory()->create();

    $response = $this->actingAs($host)->post('/mafia/rooms');

    $room = MafiaRoom::first();
    expect($room)->not->toBeNull();
    expect($room->host_user_id)->toBe($host->id);
    expect($room->status)->toBe('lobby');
    $response->assertRedirect(route('mafia.lobby', $room->room_code));

    $player = $room->players()->first();
    expect($player->user_id)->toBe($host->id);
    expect($player->slot)->toBe(1);
    expect($player->is_game_host)->toBeTrue();
    expect($player->is_ready)->toBeFalse();
});

test('a guest cannot create a mafia room', function () {
    $response = $this->post('/mafia/rooms');

    $response->assertRedirect('/login');
});

test('room codes are unique', function () {
    $codes = collect(range(1, 25))->map(fn () => MafiaRoom::generateUniqueRoomCode());

    expect($codes->unique())->toHaveCount(25);
    $codes->each(fn ($code) => expect($code)->toMatch('/^[A-Z0-9]{6}$/'));
});

test('an authenticated user can join an open room', function () {
    Event::fake([MafiaLobbyUpdated::class]);
    $host = User::factory()->create();
    $room = MafiaRoom::factory()->create(['host_user_id' => $host->id]);
    $room->players()->create(['user_id' => $host->id, 'slot' => 1, 'is_game_host' => true, 'joined_at' => now()]);

    $joiner = User::factory()->create();
    $response = $this->actingAs($joiner)->post("/mafia/{$room->room_code}/join");

    $response->assertRedirect(route('mafia.lobby', $room->room_code));
    $player = $room->players()->where('user_id', $joiner->id)->first();
    expect($player)->not->toBeNull();
    expect($player->slot)->toBe(2);
    Event::assertDispatched(MafiaLobbyUpdated::class);
});

test('a user already seated who submits join again is just sent back to the lobby', function () {
    $host = User::factory()->create();
    $room = MafiaRoom::factory()->create(['host_user_id' => $host->id]);
    $room->players()->create(['user_id' => $host->id, 'slot' => 1, 'is_game_host' => true, 'joined_at' => now()]);

    $response = $this->actingAs($host)->post("/mafia/{$room->room_code}/join");

    $response->assertRedirect(route('mafia.lobby', $room->room_code));
    expect($room->fresh()->players)->toHaveCount(1);
});

test('a password-protected room rejects the wrong password', function () {
    $host = User::factory()->create();
    $room = MafiaRoom::factory()->create([
        'host_user_id' => $host->id,
        'settings' => ['password_hash' => bcrypt('secret'), 'registered_only' => false, 'skip_role_shuffle' => true, 'autohost' => true],
    ]);
    $room->players()->create(['user_id' => $host->id, 'slot' => 1, 'is_game_host' => true, 'joined_at' => now()]);

    $joiner = User::factory()->create();
    $response = $this->actingAs($joiner)->post("/mafia/{$room->room_code}/join", ['password' => 'wrong']);

    $response->assertSessionHasErrors('password');
    expect($room->fresh()->players)->toHaveCount(1);
});

test('a password-protected room accepts the right password', function () {
    $host = User::factory()->create();
    $room = MafiaRoom::factory()->create([
        'host_user_id' => $host->id,
        'settings' => ['password_hash' => bcrypt('secret'), 'registered_only' => false, 'skip_role_shuffle' => true, 'autohost' => true],
    ]);
    $room->players()->create(['user_id' => $host->id, 'slot' => 1, 'is_game_host' => true, 'joined_at' => now()]);

    $joiner = User::factory()->create();
    $response = $this->actingAs($joiner)->post("/mafia/{$room->room_code}/join", ['password' => 'secret']);

    $response->assertRedirect(route('mafia.lobby', $room->room_code));
    expect($room->fresh()->players)->toHaveCount(2);
});

test('the seat limit is enforced server-side', function () {
    $room = MafiaRoom::factory()->create();
    for ($slot = 1; $slot <= config('mafia.seats'); $slot++) {
        $room->players()->create(['user_id' => User::factory()->create()->id, 'slot' => $slot, 'joined_at' => now()]);
    }

    $latecomer = User::factory()->create();
    $response = $this->actingAs($latecomer)->post("/mafia/{$room->room_code}/join");

    $response->assertSessionHasErrors('room');
    expect($room->fresh()->players)->toHaveCount(config('mafia.seats'));
});

test('players cannot join after the game has started', function () {
    $room = MafiaRoom::factory()->inProgress()->create();

    $latecomer = User::factory()->create();
    $response = $this->actingAs($latecomer)->post("/mafia/{$room->room_code}/join");

    $response->assertSessionHasErrors('room');
    expect($room->fresh()->players)->toHaveCount(0);
});

test('toggling ready broadcasts the updated lobby but does not start the game alone', function () {
    Event::fake([MafiaLobbyUpdated::class, MafiaGameStarting::class]);
    $host = User::factory()->create();
    $room = MafiaRoom::factory()->create(['host_user_id' => $host->id]);
    $room->players()->create(['user_id' => $host->id, 'slot' => 1, 'is_game_host' => true, 'joined_at' => now()]);
    $room->players()->create(['user_id' => User::factory()->create()->id, 'slot' => 2, 'joined_at' => now()]);

    $response = $this->actingAs($host)->post("/mafia/{$room->room_code}/ready");

    $response->assertRedirect(route('mafia.lobby', $room->room_code));
    expect($room->players()->where('user_id', $host->id)->first()->is_ready)->toBeTrue();
    Event::assertDispatched(MafiaLobbyUpdated::class);
    Event::assertNotDispatched(MafiaGameStarting::class);
    expect($room->fresh()->status)->toBe('lobby');
});

test('the game auto-starts the instant every seated player is ready, dealing roles to everyone including empty seats', function () {
    Event::fake([MafiaGameStarting::class]);
    $host = User::factory()->create();
    $room = MafiaRoom::factory()->create(['host_user_id' => $host->id]);
    $room->players()->create(['user_id' => $host->id, 'slot' => 1, 'is_game_host' => true, 'joined_at' => now()]);
    $second = User::factory()->create();
    $room->players()->create(['user_id' => $second->id, 'slot' => 2, 'joined_at' => now()]);

    // Only 2 of 10 seats filled — the other 8 must become dummy players.
    $this->actingAs($host)->post("/mafia/{$room->room_code}/ready");
    $this->actingAs($second)->post("/mafia/{$room->room_code}/ready");

    $room->refresh();
    expect($room->status)->toBe('sitdown');
    expect($room->started_at)->not->toBeNull();
    expect($room->phase_deadline_at)->not->toBeNull();
    expect($room->players)->toHaveCount(config('mafia.seats'));

    $dummies = $room->players()->whereNull('user_id')->get();
    expect($dummies)->toHaveCount(config('mafia.seats') - 2);
    $dummies->each(fn ($dummy) => expect($dummy->isDummy())->toBeTrue());

    // Every player, real or dummy, got a role from the fixed deck, and the
    // full deck's composition survived the deal intact.
    $roles = $room->players->pluck('role')->sort()->values()->all();
    expect($roles)->toBe(collect(config('mafia.role_deck'))->sort()->values()->all());

    Event::assertDispatched(MafiaGameStarting::class);
});

test('toggling ready when the game already started redirects to play instead of erroring', function () {
    $room = MafiaRoom::factory()->create(['status' => 'sitdown']);
    $player = $room->players()->create(['user_id' => User::factory()->create()->id, 'slot' => 1, 'role' => 'citizen', 'joined_at' => now()]);

    $response = $this->actingAs($player->user)->post("/mafia/{$room->room_code}/ready");

    $response->assertRedirect(route('mafia.play', $room->room_code));
});

test('the play page shows only the requesting player their own dealt role', function () {
    $room = MafiaRoom::factory()->create(['status' => 'sitdown']);
    $player = $room->players()->create(['user_id' => User::factory()->create()->id, 'slot' => 1, 'role' => 'don', 'joined_at' => now()]);

    $response = $this->actingAs($player->user)->get("/mafia/{$room->room_code}/play");

    $response->assertInertia(fn ($page) => $page
        ->component('Mafia/Play')
        ->where('snapshot.you.role', 'don')
        ->where('snapshot.you.team', 'black')
    );
});

test('visiting the lobby once the game has started redirects to play', function () {
    $room = MafiaRoom::factory()->create(['status' => 'sitdown']);
    $player = $room->players()->create(['user_id' => User::factory()->create()->id, 'slot' => 1, 'role' => 'citizen', 'joined_at' => now()]);

    $response = $this->actingAs($player->user)->get("/mafia/{$room->room_code}/lobby");

    $response->assertRedirect(route('mafia.play', $room->room_code));
});

test('visiting play while the room is still in the lobby redirects back to the lobby', function () {
    $room = MafiaRoom::factory()->create();
    $player = $room->players()->create(['user_id' => User::factory()->create()->id, 'slot' => 1, 'joined_at' => now()]);

    $response = $this->actingAs($player->user)->get("/mafia/{$room->room_code}/play");

    $response->assertRedirect(route('mafia.lobby', $room->room_code));
});

test('joining a non-existent room code shows the not-found state', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->get('/mafia/ZZZZZZ');

    $response->assertInertia(fn ($page) => $page->component('Mafia/Join')->where('state', 'not_found'));
});

test('visiting a full room shows the full state', function () {
    $room = MafiaRoom::factory()->create();
    for ($slot = 1; $slot <= config('mafia.seats'); $slot++) {
        $room->players()->create(['user_id' => User::factory()->create()->id, 'slot' => $slot, 'joined_at' => now()]);
    }

    $visitor = User::factory()->create();
    $response = $this->actingAs($visitor)->get("/mafia/{$room->room_code}");

    $response->assertInertia(fn ($page) => $page->component('Mafia/Join')->where('state', 'full'));
});

test('a user already seated visiting the show page is redirected straight to the lobby', function () {
    $room = MafiaRoom::factory()->create();
    $player = $room->players()->create(['user_id' => User::factory()->create()->id, 'slot' => 1, 'joined_at' => now()]);

    $response = $this->actingAs($player->user)->get("/mafia/{$room->room_code}");

    $response->assertRedirect(route('mafia.lobby', $room->room_code));
});

test('the game-host leaving the lobby cancels the room', function () {
    Event::fake([MafiaRoomCancelled::class]);
    $host = User::factory()->create();
    $room = MafiaRoom::factory()->create(['host_user_id' => $host->id]);
    $room->players()->create(['user_id' => $host->id, 'slot' => 1, 'is_game_host' => true, 'joined_at' => now()]);

    $this->actingAs($host)->post("/mafia/{$room->room_code}/leave");

    expect($room->fresh()->status)->toBe('cancelled');
    expect($room->players()->count())->toBe(0);
    Event::assertDispatched(MafiaRoomCancelled::class);
});

test('a non-host player leaving the lobby does not cancel the room', function () {
    $host = User::factory()->create();
    $room = MafiaRoom::factory()->create(['host_user_id' => $host->id]);
    $room->players()->create(['user_id' => $host->id, 'slot' => 1, 'is_game_host' => true, 'joined_at' => now()]);
    $guest = User::factory()->create();
    $room->players()->create(['user_id' => $guest->id, 'slot' => 2, 'joined_at' => now()]);

    $this->actingAs($guest)->post("/mafia/{$room->room_code}/leave");

    expect($room->fresh()->status)->toBe('lobby');
    expect($room->players()->count())->toBe(1);
    expect($room->players()->first()->user_id)->toBe($host->id);
});
