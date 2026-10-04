<?php

use App\Events\Race\RaceFinished;
use App\Events\Race\RaceQuestionEnded;
use App\Events\Race\RaceQuestionStarted;
use App\Models\RaceAnswer;
use App\Models\RacePlayer;
use App\Models\RaceRoom;
use App\Models\User;
use App\Services\RaceTickService;
use Illuminate\Support\Facades\Event;

function startedRaceRoom(): RaceRoom
{
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create([
        'quiz_id' => $quiz->id,
        'host_user_id' => $owner->id,
        'status' => 'starting',
        'question_order' => $quiz->questions->pluck('id')->all(),
        'started_at' => now()->subSecond(),
    ]);

    return $room;
}

test('race:tick advances a starting room to the first question once its go-at time has passed', function () {
    Event::fake([RaceQuestionStarted::class]);
    $room = startedRaceRoom();

    (new RaceTickService())->tick();

    $room->refresh();
    expect($room->status)->toBe('question');
    expect($room->current_question_index)->toBe(0);
    expect($room->current_question_started_at)->not->toBeNull();
    expect($room->current_question_deadline_at)->not->toBeNull();
    Event::assertDispatched(RaceQuestionStarted::class);
});

test('race:tick does not advance a starting room before its go-at time', function () {
    Event::fake([RaceQuestionStarted::class]);
    $room = startedRaceRoom();
    $room->update(['started_at' => now()->addMinute()]);

    (new RaceTickService())->tick();

    expect($room->fresh()->status)->toBe('starting');
    Event::assertNotDispatched(RaceQuestionStarted::class);
});

test('race:tick moves an expired question to question_results and broadcasts the correct answer', function () {
    Event::fake([RaceQuestionEnded::class]);
    $room = startedRaceRoom();
    $room->update([
        'status' => 'question',
        'current_question_started_at' => now()->subSeconds(20),
        'current_question_deadline_at' => now()->subSecond(),
    ]);

    (new RaceTickService())->tick();

    $room->refresh();
    expect($room->status)->toBe('question_results');
    expect($room->results_reveal_until)->not->toBeNull();
    Event::assertDispatched(RaceQuestionEnded::class);
});

test('race:tick does not end a question before its deadline', function () {
    Event::fake([RaceQuestionEnded::class]);
    $room = startedRaceRoom();
    $room->update([
        'status' => 'question',
        'current_question_started_at' => now(),
        'current_question_deadline_at' => now()->addSeconds(15),
    ]);

    (new RaceTickService())->tick();

    expect($room->fresh()->status)->toBe('question');
    Event::assertNotDispatched(RaceQuestionEnded::class);
});

test('race:tick advances question_results to the next question when more remain', function () {
    Event::fake([RaceQuestionStarted::class]);
    $room = startedRaceRoom();
    $room->update([
        'status' => 'question_results',
        'current_question_index' => 0,
        'results_reveal_until' => now()->subSecond(),
    ]);

    (new RaceTickService())->tick();

    $room->refresh();
    expect($room->status)->toBe('question');
    expect($room->current_question_index)->toBe(1);
    Event::assertDispatched(RaceQuestionStarted::class);
});

test('race:tick finishes the race after the last question\'s results are shown', function () {
    Event::fake([RaceFinished::class]);
    $room = startedRaceRoom();
    $lastIndex = count($room->question_order) - 1;
    $room->update([
        'status' => 'question_results',
        'current_question_index' => $lastIndex,
        'results_reveal_until' => now()->subSecond(),
    ]);

    (new RaceTickService())->tick();

    $room->refresh();
    expect($room->status)->toBe('finished');
    expect($room->finished_at)->not->toBeNull();
    Event::assertDispatched(RaceFinished::class);
});

test('a player can submit exactly one answer per question and is scored server-side', function () {
    $room = startedRaceRoom();
    $room->update([
        'status' => 'question',
        'current_question_started_at' => now(),
        'current_question_deadline_at' => now()->addSeconds(15),
    ]);
    $question = $room->currentQuestion();
    $correctAnswer = $question->correctAnswer();
    $player = RacePlayer::factory()->create(['race_room_id' => $room->id, 'session_token' => 'token-1']);

    $response = $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->post("/race/{$room->room_code}/answer", ['answer_id' => $correctAnswer->id]);

    $response->assertRedirect(route('race.play', $room->room_code));
    $raceAnswer = RaceAnswer::where('race_player_id', $player->id)->first();
    expect($raceAnswer)->not->toBeNull();
    expect($raceAnswer->is_correct)->toBeTrue();
    expect($raceAnswer->points)->toBeGreaterThanOrEqual(config('race.base_points'));
    expect($player->fresh()->score)->toBe($raceAnswer->points);
});

test('a duplicate answer submission for the same question is rejected and does not double-score', function () {
    $room = startedRaceRoom();
    $room->update([
        'status' => 'question',
        'current_question_started_at' => now(),
        'current_question_deadline_at' => now()->addSeconds(15),
    ]);
    $question = $room->currentQuestion();
    $correctAnswer = $question->correctAnswer();
    $player = RacePlayer::factory()->create(['race_room_id' => $room->id, 'session_token' => 'token-1']);

    $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->post("/race/{$room->room_code}/answer", ['answer_id' => $correctAnswer->id]);
    $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->post("/race/{$room->room_code}/answer", ['answer_id' => $correctAnswer->id]);

    expect(RaceAnswer::where('race_player_id', $player->id)->count())->toBe(1);
    $firstPoints = RaceAnswer::where('race_player_id', $player->id)->first()->points;
    expect($player->fresh()->score)->toBe($firstPoints);
});

test('an answer submitted after the deadline is rejected', function () {
    $room = startedRaceRoom();
    $room->update([
        'status' => 'question',
        'current_question_started_at' => now()->subSeconds(20),
        'current_question_deadline_at' => now()->subSecond(),
    ]);
    $question = $room->currentQuestion();
    $correctAnswer = $question->correctAnswer();
    $player = RacePlayer::factory()->create(['race_room_id' => $room->id, 'session_token' => 'token-1']);

    $response = $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->post("/race/{$room->room_code}/answer", ['answer_id' => $correctAnswer->id]);

    $response->assertSessionHasErrors('answer_id');
    expect(RaceAnswer::where('race_player_id', $player->id)->count())->toBe(0);
    expect($player->fresh()->score)->toBe(0);
});

test('an incorrect answer earns zero points', function () {
    $room = startedRaceRoom();
    $room->update([
        'status' => 'question',
        'current_question_started_at' => now(),
        'current_question_deadline_at' => now()->addSeconds(15),
    ]);
    $question = $room->currentQuestion();
    $wrongAnswer = $question->answers->firstWhere('is_correct', false);
    $player = RacePlayer::factory()->create(['race_room_id' => $room->id, 'session_token' => 'token-1']);

    $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->post("/race/{$room->room_code}/answer", ['answer_id' => $wrongAnswer->id]);

    expect($player->fresh()->score)->toBe(0);
    expect(RaceAnswer::where('race_player_id', $player->id)->first()->is_correct)->toBeFalse();
});

test('a player cannot answer while the room is not in the question state', function () {
    // Redirects gracefully rather than a hard error — this can happen
    // legitimately when race:tick has just moved the room on (e.g. an
    // answer arriving right as the deadline passes), not just from
    // hitting the endpoint outright out of turn.
    $room = startedRaceRoom();
    $question = $room->quiz->questions()->first();
    $answer = $question->answers()->first();
    $player = RacePlayer::factory()->create(['race_room_id' => $room->id, 'session_token' => 'token-1']);

    $response = $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->post("/race/{$room->room_code}/answer", ['answer_id' => $answer->id]);

    $response->assertRedirect(route('race.play', $room->room_code));
    expect($player->answers()->count())->toBe(0);
});

test('the leaderboard reflects server-recorded scores only, ordered highest first', function () {
    $room = startedRaceRoom();
    $winner = RacePlayer::factory()->create(['race_room_id' => $room->id, 'score' => 500]);
    $loser = RacePlayer::factory()->create(['race_room_id' => $room->id, 'score' => 100]);

    $leaderboard = $room->leaderboard();

    expect($leaderboard[0]['id'])->toBe($winner->id);
    expect($leaderboard[1]['id'])->toBe($loser->id);
});

test('visiting play while the room is still in the lobby redirects back to the lobby', function () {
    $owner = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $owner->id]);
    $room->players()->create(['nickname' => 'Fox', 'session_token' => 'token-1', 'joined_at' => now()]);

    $response = $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->get("/race/{$room->room_code}/play");

    $response->assertRedirect(route('race.lobby', $room->room_code));
});

test('visiting the lobby once the race has started redirects to play', function () {
    $room = startedRaceRoom();
    $room->update(['status' => 'question', 'current_question_deadline_at' => now()->addSeconds(15)]);
    $room->players()->create(['nickname' => 'Fox', 'session_token' => 'token-1', 'joined_at' => now()]);

    $response = $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->get("/race/{$room->room_code}/lobby");

    $response->assertRedirect(route('race.play', $room->room_code));
});

test('the state endpoint never exposes the correct answer while the question is still active', function () {
    $room = startedRaceRoom();
    $room->update([
        'status' => 'question',
        'current_question_started_at' => now(),
        'current_question_deadline_at' => now()->addSeconds(15),
    ]);
    $room->players()->create(['nickname' => 'Fox', 'session_token' => 'token-1', 'joined_at' => now()]);

    $response = $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->get("/race/{$room->room_code}/state");

    $response->assertOk();
    $response->assertJson(['status' => 'question', 'correctAnswerId' => null]);
    foreach ($response->json('question.answers') as $answer) {
        expect($answer)->not->toHaveKey('is_correct');
    }
});

test('the state endpoint exposes the correct answer once the question has ended', function () {
    $room = startedRaceRoom();
    $question = $room->currentQuestion();
    $room->update([
        'status' => 'question_results',
        'current_question_started_at' => now()->subSeconds(20),
        'current_question_deadline_at' => now()->subSeconds(5),
        'results_reveal_until' => now()->addSeconds(5),
    ]);
    $room->players()->create(['nickname' => 'Fox', 'session_token' => 'token-1', 'joined_at' => now()]);

    $response = $this->withSession(["race_player_token.{$room->id}" => 'token-1'])
        ->get("/race/{$room->room_code}/state");

    $response->assertOk();
    expect($response->json('correctAnswerId'))->toBe($question->correctAnswer()->id);
    expect($response->json('leaderboard'))->not->toBeNull();
});
