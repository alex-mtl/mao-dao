<?php

use App\Models\Quiz;
use App\Models\QuizAttempt;
use App\Models\Tag;
use App\Models\User;
use App\Services\QuizRecommendationService;

test('a quiz matching the user selected tags outranks one that does not', function () {
    $user = User::factory()->create(['ui_language' => 'en']);
    $owner = User::factory()->create();
    $tag = Tag::factory()->create();
    $otherTag = Tag::factory()->create();

    $user->tags()->attach($tag);

    $matching = Quiz::factory()->published()->create(['user_id' => $owner->id, 'language' => 'en']);
    $matching->tags()->attach($tag);

    $nonMatching = Quiz::factory()->published()->create(['user_id' => $owner->id, 'language' => 'en']);
    $nonMatching->tags()->attach($otherTag);

    $ordered = (new QuizRecommendationService())->forUser($user)->pluck('id')->all();

    expect(array_search($matching->id, $ordered))->toBeLessThan(array_search($nonMatching->id, $ordered));
});

test('liked and passed quiz tags boost related quizzes', function () {
    $user = User::factory()->create(['ui_language' => 'en']);
    $owner = User::factory()->create();
    $likedTag = Tag::factory()->create();
    $neutralTag = Tag::factory()->create();

    $likedQuiz = Quiz::factory()->published()->create(['user_id' => $owner->id, 'language' => 'en']);
    $likedQuiz->tags()->attach($likedTag);
    $user->likedQuizzes()->attach($likedQuiz->id);

    $relatedToLiked = Quiz::factory()->published()->create(['user_id' => $owner->id, 'language' => 'en']);
    $relatedToLiked->tags()->attach($likedTag);

    $unrelated = Quiz::factory()->published()->create(['user_id' => $owner->id, 'language' => 'en']);
    $unrelated->tags()->attach($neutralTag);

    $ordered = (new QuizRecommendationService())->forUser($user)->pluck('id')->all();

    expect(array_search($relatedToLiked->id, $ordered))->toBeLessThan(array_search($unrelated->id, $ordered));
});

test('already attempted quizzes are excluded from recommendations', function () {
    $user = User::factory()->create();
    $owner = User::factory()->create();
    $quiz = Quiz::factory()->published()->create(['user_id' => $owner->id]);

    QuizAttempt::create([
        'quiz_id' => $quiz->id,
        'user_id' => $user->id,
        'total_questions' => 1,
        'correct_count' => 1,
        'percentage' => 100,
        'passed' => true,
    ]);

    $ordered = (new QuizRecommendationService())->forUser($user)->pluck('id')->all();

    expect($ordered)->not->toContain($quiz->id);
});

test('quizzes in other languages are not excluded, only unweighted', function () {
    $user = User::factory()->create(['ui_language' => 'en']);
    $owner = User::factory()->create();
    $tag = Tag::factory()->create();
    $user->tags()->attach($tag);

    $frenchQuiz = Quiz::factory()->published()->create(['user_id' => $owner->id, 'language' => 'fr']);
    $frenchQuiz->tags()->attach($tag);

    $ordered = (new QuizRecommendationService())->forUser($user)->pluck('id')->all();

    expect($ordered)->toContain($frenchQuiz->id);
});

test('a user own quizzes are excluded from their own recommendations', function () {
    $user = User::factory()->create();
    $ownQuiz = Quiz::factory()->published()->create(['user_id' => $user->id]);

    $ordered = (new QuizRecommendationService())->forUser($user)->pluck('id')->all();

    expect($ordered)->not->toContain($ownQuiz->id);
});
