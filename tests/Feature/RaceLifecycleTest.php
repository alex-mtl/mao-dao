<?php

use App\Events\Race\RaceCancelled;
use App\Events\Race\RacePlayAgain;
use App\Models\RaceRoom;
use App\Models\User;
use App\Services\RaceTickService;
use Illuminate\Support\Facades\Event;

test('the host can play again after the race finishes, creating a brand new room', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $oldRoom = RaceRoom::factory()->finished()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);
    $oldRoom->players()->create([
        'user_id' => $owner->id, 'nickname' => 'Host', 'session_token' => 'host-token',
        'is_host' => true, 'joined_at' => now(), 'last_seen_at' => now(),
    ]);

    Event::fake([RacePlayAgain::class]);

    $response = $this->withSession(["race_player_token.{$oldRoom->id}" => 'host-token'])
        ->actingAs($owner)
        ->post("/race/{$oldRoom->room_code}/play-again");

    $newRoom = RaceRoom::where('id', '!=', $oldRoom->id)->first();
    expect($newRoom)->not->toBeNull();
    expect($newRoom->quiz_id)->toBe($quiz->id);
    expect($newRoom->status)->toBe('lobby');
    expect($newRoom->room_code)->not->toBe($oldRoom->room_code);
    $response->assertRedirect(route('race.lobby', $newRoom->room_code));

    // The old, completed room is untouched.
    expect($oldRoom->fresh()->status)->toBe('finished');
    Event::assertDispatched(RacePlayAgain::class);
});

test('a non-host cannot play again', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->finished()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);
    $room->players()->create([
        'nickname' => 'Guest', 'session_token' => 'guest-token', 'is_host' => false,
        'joined_at' => now(), 'last_seen_at' => now(),
    ]);
    $guestUser = User::factory()->create();

    $response = $this->withSession(["race_player_token.{$room->id}" => 'guest-token'])
        ->actingAs($guestUser)
        ->post("/race/{$room->room_code}/play-again");

    $response->assertForbidden();
    expect(RaceRoom::count())->toBe(1);
});

test('play again is rejected unless the race has actually finished', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id, 'status' => 'lobby']);
    $room->players()->create([
        'user_id' => $owner->id, 'nickname' => 'Host', 'session_token' => 'host-token',
        'is_host' => true, 'joined_at' => now(), 'last_seen_at' => now(),
    ]);

    $response = $this->withSession(["race_player_token.{$room->id}" => 'host-token'])
        ->actingAs($owner)
        ->post("/race/{$room->room_code}/play-again");

    $response->assertStatus(409);
    expect(RaceRoom::count())->toBe(1);
});

test('a player reconnecting mid-question sees the current question and their own answer state', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create([
        'quiz_id' => $quiz->id,
        'host_user_id' => $owner->id,
        'status' => 'question',
        'question_order' => $quiz->questions->pluck('id')->all(),
        'current_question_started_at' => now(),
        'current_question_deadline_at' => now()->addSeconds(15),
    ]);
    $player = $room->players()->create([
        'nickname' => 'Fox', 'session_token' => 'token-1', 'joined_at' => now(), 'last_seen_at' => now(),
    ]);
    $question = $room->currentQuestion();
    $correctAnswer = $question->correctAnswer();
    $player->answers()->create([
        'question_id' => $question->id, 'answer_id' => $correctAnswer->id,
        'is_correct' => true, 'response_time_ms' => 1000, 'points' => 1400,
    ]);

    // Simulates a browser refresh: a fresh GET with the same session
    // token (identity), no memory of anything from before the reload.
    $response = $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->get("/race/{$room->room_code}/play");

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('Race/Play')
        ->where('status', 'question')
        ->where('hasAnswered', true)
        ->where('selectedAnswerId', $correctAnswer->id)
        ->where('question.id', $question->id)
    );
});

test('reconnecting does not create a second Race Player for the same session', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);
    $room->players()->create([
        'nickname' => 'Fox', 'session_token' => 'token-1', 'joined_at' => now(), 'last_seen_at' => now(),
    ]);

    $this->withSession(["race_player_token.{$room->id}" => 'token-1'])->get("/race/{$room->room_code}/lobby");
    $this->withSession(["race_player_token.{$room->id}" => 'token-1'])->get("/race/{$room->room_code}/lobby");

    expect($room->players()->count())->toBe(1);
});

test('race:tick cancels a lobby whose host has gone silent', function () {
    Event::fake([RaceCancelled::class]);
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id, 'status' => 'lobby']);
    $room->players()->create([
        'user_id' => $owner->id, 'nickname' => 'Host', 'session_token' => 'host-token', 'is_host' => true,
        'joined_at' => now()->subMinute(),
        'last_seen_at' => now()->subSeconds(config('race.host_disconnect_timeout_seconds') + 5),
    ]);

    (new RaceTickService())->tick();

    expect($room->fresh()->status)->toBe('cancelled');
    Event::assertDispatched(RaceCancelled::class);
});

test('race:tick does not cancel a lobby whose host was recently seen', function () {
    Event::fake([RaceCancelled::class]);
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id, 'status' => 'lobby']);
    $room->players()->create([
        'user_id' => $owner->id, 'nickname' => 'Host', 'session_token' => 'host-token', 'is_host' => true,
        'joined_at' => now(), 'last_seen_at' => now(),
    ]);

    (new RaceTickService())->tick();

    expect($room->fresh()->status)->toBe('lobby');
    Event::assertNotDispatched(RaceCancelled::class);
});

test('an in-progress race is never cancelled just because the host has gone quiet', function () {
    Event::fake([RaceCancelled::class]);
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create([
        'quiz_id' => $quiz->id, 'host_user_id' => $owner->id,
        'status' => 'question',
        'question_order' => $quiz->questions->pluck('id')->all(),
        'current_question_started_at' => now(),
        'current_question_deadline_at' => now()->addSeconds(15),
    ]);
    $room->players()->create([
        'user_id' => $owner->id, 'nickname' => 'Host', 'session_token' => 'host-token', 'is_host' => true,
        'joined_at' => now()->subMinutes(5),
        'last_seen_at' => now()->subMinutes(5),
    ]);

    (new RaceTickService())->tick();

    expect($room->fresh()->status)->toBe('question');
    Event::assertNotDispatched(RaceCancelled::class);
});

test('race:cleanup deletes old finished and cancelled rooms but leaves recent ones', function () {
    $old = RaceRoom::factory()->finished()->create(['updated_at' => now()->subHours(48)]);
    $oldCancelled = RaceRoom::factory()->create(['status' => 'cancelled', 'updated_at' => now()->subHours(48)]);
    $recent = RaceRoom::factory()->finished()->create(['updated_at' => now()]);

    $this->artisan('race:cleanup')->assertSuccessful();

    expect(RaceRoom::find($old->id))->toBeNull();
    expect(RaceRoom::find($oldCancelled->id))->toBeNull();
    expect(RaceRoom::find($recent->id))->not->toBeNull();
});

test('creating a new race opportunistically cleans up old finished rooms', function () {
    $stale = RaceRoom::factory()->finished()->create(['updated_at' => now()->subHours(48)]);
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);

    $this->actingAs($owner)->post("/quizzes/{$quiz->id}/race");

    expect(RaceRoom::find($stale->id))->toBeNull();
});

test('a finished race cannot be started or answered again', function () {
    // Hitting /start or /answer on a room that's no longer in the
    // expected state is treated as a benign timing race (e.g. a click
    // landing just as race:tick already moved things on), not a hard
    // error — so these redirect gracefully rather than aborting, but
    // must never actually mutate a finished room.
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->finished()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);
    $room->players()->create([
        'nickname' => 'Host', 'session_token' => 'host-token', 'is_host' => true,
        'joined_at' => now(), 'last_seen_at' => now(),
    ]);

    // /start sits behind the `auth` middleware (starting a race is always
    // an authenticated action), unlike /answer below.
    $startResponse = $this->withSession(["race_player_token.{$room->id}" => 'host-token'])
        ->actingAs($owner)
        ->post("/race/{$room->room_code}/start");
    $startResponse->assertRedirect(route('race.lobby', $room->room_code));
    expect($room->fresh()->status)->toBe('finished');

    $question = $room->quiz->questions()->first();
    $answerResponse = $this->withSession(["race_player_token.{$room->id}" => 'host-token'])
        ->post("/race/{$room->room_code}/answer", ['answer_id' => $question->answers()->first()->id]);
    $answerResponse->assertRedirect(route('race.play', $room->room_code));
    expect($room->players()->first()->answers()->count())->toBe(0);
});
