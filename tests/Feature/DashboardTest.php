<?php

use App\Models\Group;
use App\Models\Quiz;
use App\Models\QuizAttempt;
use App\Models\User;

test('the dashboard shows the users own quizzes, attempts, likes, and groups with real data', function () {
    $user = User::factory()->create();
    $ownQuiz = Quiz::factory()->create(['user_id' => $user->id, 'title' => 'My Own Quiz']);

    $otherOwner = User::factory()->create();
    $playedQuiz = Quiz::factory()->published()->create(['user_id' => $otherOwner->id, 'title' => 'Played Quiz']);
    QuizAttempt::create([
        'quiz_id' => $playedQuiz->id, 'user_id' => $user->id,
        'total_questions' => 1, 'correct_count' => 1, 'percentage' => 100, 'passed' => true,
    ]);

    $likedQuiz = Quiz::factory()->published()->create(['user_id' => $otherOwner->id, 'title' => 'Liked Quiz']);
    $user->likedQuizzes()->attach($likedQuiz->id);

    $group = Group::create(['owner_id' => $user->id, 'name' => 'My Group']);
    $group->members()->attach($user->id);

    $response = $this->actingAs($user)->get('/dashboard');

    $response->assertInertia(fn ($page) => $page
        ->where('myQuizzes.0.title', 'My Own Quiz')
        ->where('recentAttempts.0.quiz.title', 'Played Quiz')
        ->where('likedQuizzes.0.title', 'Liked Quiz')
        ->where('groups.0.name', 'My Group'));
});

test('an empty dashboard does not error and shows no fake data', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->get('/dashboard');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->where('myQuizzes', [])
        ->where('recentAttempts', [])
        ->where('likedQuizzes', [])
        ->where('groups', []));
});
