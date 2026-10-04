<?php

use App\Models\Quiz;
use App\Models\RaceRoom;
use App\Models\User;

test('an authorized user can start a race for a published quiz', function () {
    $owner = User::factory()->create();
    $host = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);

    $response = $this->actingAs($host)->post("/quizzes/{$quiz->id}/race");

    $room = RaceRoom::first();
    expect($room)->not->toBeNull();
    expect($room->quiz_id)->toBe($quiz->id);
    expect($room->host_user_id)->toBe($host->id);
    expect($room->status)->toBe('lobby');
    $response->assertRedirect(route('race.lobby', $room->room_code));

    // The host is automatically seated as a player, with their own room
    // identity independent of their account name being just a default.
    $hostPlayer = $room->players()->first();
    expect($hostPlayer->is_host)->toBeTrue();
    expect($hostPlayer->user_id)->toBe($host->id);
});

test('a user cannot start a race for a draft quiz', function () {
    $owner = User::factory()->create();
    $quiz = Quiz::factory()->create(['user_id' => $owner->id, 'status' => 'draft']);

    $response = $this->actingAs($owner)->post("/quizzes/{$quiz->id}/race");

    $response->assertNotFound();
    expect(RaceRoom::count())->toBe(0);
});

test('a guest cannot start a race', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);

    $response = $this->post("/quizzes/{$quiz->id}/race");

    $response->assertRedirect('/login');
});

test('room codes are unique', function () {
    $codes = collect(range(1, 25))->map(fn () => RaceRoom::generateUniqueRoomCode());

    expect($codes->unique())->toHaveCount(25);
    $codes->each(fn ($code) => expect($code)->toMatch('/^[A-Z0-9]{6}$/'));
});

test('an anonymous visitor can join a race with a temporary nickname', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);

    $response = $this->post("/race/{$room->room_code}/join", ['nickname' => 'Fox']);

    $response->assertRedirect(route('race.lobby', $room->room_code));
    $player = $room->players()->where('nickname', 'Fox')->first();
    expect($player)->not->toBeNull();
    expect($player->user_id)->toBeNull();
});

test('an authenticated user can join with a nickname independent of their account name', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);
    $player = User::factory()->create(['name' => 'Alexander Johnson']);

    $this->actingAs($player)->post("/race/{$room->room_code}/join", ['nickname' => 'Fox']);

    $racePlayer = $room->players()->where('user_id', $player->id)->first();
    expect($racePlayer->nickname)->toBe('Fox');
    expect($player->fresh()->name)->toBe('Alexander Johnson');
});

test('a duplicate nickname within the same room is rejected', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);
    $room->players()->create([
        'nickname' => 'Fox', 'session_token' => 'existing-token', 'joined_at' => now(),
    ]);

    $response = $this->post("/race/{$room->room_code}/join", ['nickname' => 'fox']);

    $response->assertSessionHasErrors('nickname');
    expect($room->players()->count())->toBe(1);
});

test('the player limit is enforced server-side', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id, 'max_players' => 1]);
    $room->players()->create(['nickname' => 'First', 'session_token' => 'token-1', 'joined_at' => now()]);

    $response = $this->post("/race/{$room->room_code}/join", ['nickname' => 'Second']);

    $response->assertSessionHasErrors('nickname');
    expect($room->players()->count())->toBe(1);
});

test('players cannot join after the race has started', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->question()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);

    $response = $this->post("/race/{$room->room_code}/join", ['nickname' => 'Latecomer']);

    $response->assertSessionHasErrors('nickname');
    expect($room->players()->count())->toBe(0);
});

test('only the host can start the race', function () {
    // /race/{code}/start sits behind the `auth` middleware (starting a
    // race is always something a real account does), so the non-host
    // attempting it here must be a genuinely authenticated second user —
    // an anonymous guest would be redirected to /login (302) before ever
    // reaching the controller's own host check, which isn't what this
    // test means to exercise.
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);
    $room->players()->create([
        'user_id' => $owner->id, 'nickname' => 'Host', 'session_token' => 'host-token',
        'is_host' => true, 'joined_at' => now(),
    ]);

    $otherUser = User::factory()->create();
    $joinResponse = $this->actingAs($otherUser)->post("/race/{$room->room_code}/join", ['nickname' => 'Guest']);
    $joinResponse->assertRedirect(route('race.lobby', $room->room_code));

    // Still acting as $otherUser (the guest, not the host) tries to start.
    $response = $this->actingAs($otherUser)->post("/race/{$room->room_code}/start");

    $response->assertForbidden();
    expect($room->fresh()->status)->toBe('lobby');
});

test('the host starting the race snapshots the question order and moves to starting', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);

    $this->actingAs($owner)->post("/quizzes/{$quiz->id}/race");
    $room = RaceRoom::first();

    $response = $this->actingAs($owner)->post("/race/{$room->room_code}/start");

    $response->assertRedirect(route('race.lobby', $room->room_code));
    $room->refresh();
    expect($room->status)->toBe('starting');
    expect($room->question_order)->toBe($quiz->questions->pluck('id')->all());
});

test('joining a non-existent room code shows the not-found state', function () {
    $response = $this->get('/race/ZZZZZZ');

    $response->assertInertia(fn ($page) => $page
        ->component('Race/Join')
        ->where('state', 'not_found')
    );
});

test('visiting a full room shows the full state', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id, 'max_players' => 1]);
    $room->players()->create(['nickname' => 'First', 'session_token' => 'token-1', 'joined_at' => now()]);

    $response = $this->get("/race/{$room->room_code}");

    $response->assertInertia(fn ($page) => $page->component('Race/Join')->where('state', 'full'));
});

test('a visitor with an existing session identity is redirected straight to the lobby', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);

    // The test client's session persists across sequential calls in the
    // same test, exactly like a real browser session would.
    $this->post("/race/{$room->room_code}/join", ['nickname' => 'Fox']);

    $response = $this->get("/race/{$room->room_code}");

    $response->assertRedirect(route('race.lobby', $room->room_code));
});

test('the host leaving the lobby cancels the room', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);

    $this->actingAs($owner)->post("/quizzes/{$quiz->id}/race");
    $room = RaceRoom::first();

    $this->actingAs($owner)->post("/race/{$room->room_code}/leave");

    expect($room->fresh()->status)->toBe('cancelled');
    expect($room->players()->count())->toBe(0);
});

test('a non-host player leaving the lobby does not cancel the room', function () {
    // Built directly via factories (not the authenticated store() endpoint)
    // so this test's later anonymous join isn't done as the host — Laravel's
    // test client keeps `actingAs()` active for every subsequent call in
    // the same test, which would otherwise make a "guest" join silently
    // resume the host's own identity instead of creating a second player.
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);
    $room->players()->create([
        'user_id' => $owner->id, 'nickname' => 'Host', 'session_token' => 'host-token',
        'is_host' => true, 'joined_at' => now(),
    ]);

    $this->post("/race/{$room->room_code}/join", ['nickname' => 'Guest']);
    $this->post("/race/{$room->room_code}/leave");

    expect($room->fresh()->status)->toBe('lobby');
    expect($room->players()->count())->toBe(1);
    expect($room->players()->first()->nickname)->toBe('Host');
});
