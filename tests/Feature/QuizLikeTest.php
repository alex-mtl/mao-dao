<?php

use App\Models\Quiz;
use App\Models\QuizLike;
use App\Models\User;

test('a user can like and unlike a quiz', function () {
    $owner = User::factory()->create();
    $user = User::factory()->create();
    $quiz = Quiz::factory()->published()->create(['user_id' => $owner->id]);

    $this->actingAs($user)->post("/quizzes/{$quiz->id}/like")->assertRedirect();
    $this->assertDatabaseHas('quiz_likes', ['user_id' => $user->id, 'quiz_id' => $quiz->id]);

    $this->actingAs($user)->delete("/quizzes/{$quiz->id}/like")->assertRedirect();
    $this->assertDatabaseMissing('quiz_likes', ['user_id' => $user->id, 'quiz_id' => $quiz->id]);
});

test('liking the same quiz twice does not create a duplicate', function () {
    $owner = User::factory()->create();
    $user = User::factory()->create();
    $quiz = Quiz::factory()->published()->create(['user_id' => $owner->id]);

    $this->actingAs($user)->post("/quizzes/{$quiz->id}/like");
    $this->actingAs($user)->post("/quizzes/{$quiz->id}/like");

    expect(QuizLike::where('user_id', $user->id)->where('quiz_id', $quiz->id)->count())->toBe(1);
});
