<?php

use App\Models\Quiz;
use App\Models\RaceAnswer;
use App\Models\RacePlayer;
use App\Models\RaceRoom;
use App\Models\User;

test('a race room belongs to a quiz and a host, and lists its players', function () {
    $host = User::factory()->create();
    $quiz = Quiz::factory()->published()->create();
    $room = RaceRoom::factory()->create(['quiz_id' => $quiz->id, 'host_user_id' => $host->id]);
    $player = RacePlayer::factory()->host()->create(['race_room_id' => $room->id, 'user_id' => $host->id]);

    expect($room->quiz->is($quiz))->toBeTrue();
    expect($room->host->is($host))->toBeTrue();
    expect($room->players)->toHaveCount(1);
    expect($room->players->first()->is($player))->toBeTrue();
    expect($player->is_host)->toBeTrue();
});

test('a race room defaults to the lobby status and the configured max players', function () {
    $room = RaceRoom::factory()->create();

    expect($room->status)->toBe('lobby');
    expect($room->max_players)->toBe(config('race.default_max_players'));
});

test('an anonymous race player has no linked user account', function () {
    $player = RacePlayer::factory()->create();

    expect($player->user_id)->toBeNull();
    expect($player->user)->toBeNull();
});

test('a race answer belongs to its player, question, and answer', function () {
    $player = RacePlayer::factory()->create();
    $raceAnswer = RaceAnswer::factory()->create(['race_player_id' => $player->id, 'is_correct' => true, 'points' => 1250]);

    expect($raceAnswer->player->is($player))->toBeTrue();
    expect($raceAnswer->is_correct)->toBeTrue();
    expect($raceAnswer->points)->toBe(1250);
});

test('a room cannot have two race answers from the same player for the same question', function () {
    $player = RacePlayer::factory()->create();
    $question = \App\Models\Question::factory()->create();

    RaceAnswer::factory()->create(['race_player_id' => $player->id, 'question_id' => $question->id]);

    expect(fn () => RaceAnswer::factory()->create(['race_player_id' => $player->id, 'question_id' => $question->id]))
        ->toThrow(\Illuminate\Database\QueryException::class);
});

test('isJoinable is false once the room leaves the lobby or fills up', function () {
    $room = RaceRoom::factory()->create(['max_players' => 1]);
    expect($room->isJoinable())->toBeTrue();

    RacePlayer::factory()->create(['race_room_id' => $room->id]);
    expect($room->fresh()->isJoinable())->toBeFalse();
    expect($room->fresh()->isFull())->toBeTrue();

    $startedRoom = RaceRoom::factory()->question()->create();
    expect($startedRoom->isJoinable())->toBeFalse();
});
