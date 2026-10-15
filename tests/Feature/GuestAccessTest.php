<?php

use App\Models\MafiaRoom;
use App\Models\Quiz;
use App\Models\QuizAttempt;
use App\Models\User;

/**
 * The platform is public by default: browsing, playing a published quiz and
 * watching games need no account. Only creating things and personal pages do.
 */

function publishedQuiz(): Quiz
{
    $quiz = Quiz::factory()->create(['status' => 'published', 'published_at' => now()]);
    $question = $quiz->questions()->create(['text' => 'Q1', 'position' => 1]);
    $question->answers()->create(['text' => 'right', 'is_correct' => true]);
    $question->answers()->create(['text' => 'wrong', 'is_correct' => false]);

    return $quiz->fresh(['questions.answers']);
}

test('a guest sees the quiz library and a published quiz', function () {
    $quiz = publishedQuiz();

    $this->get('/quiz/library')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->component('Quizzes/Library')->where('tab', 'all'));

    $this->get("/quiz/quizzes/{$quiz->id}")
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('Quizzes/Show')
            ->where('quiz.liked_by_user', false)
            ->where('quiz.can_copy', false)
            ->where('quiz.is_owner', false));
});

test('the quiz section opens for a guest at the library', function () {
    $this->get('/quiz')->assertRedirect(route('library.index'));
});

test('the personal "recommended" tab falls back to the full library for a guest', function () {
    $this->get('/quiz/library?tab=recommended')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->where('tab', 'all'));
});

test('a draft quiz is not visible to a guest', function () {
    $draft = Quiz::factory()->create(['status' => 'draft']);

    $this->get("/quiz/quizzes/{$draft->id}")->assertForbidden();
});

test('a guest can play a quiz and sees their own result, nobody else does', function () {
    $quiz = publishedQuiz();
    $question = $quiz->questions->first();
    $correct = $question->answers->firstWhere('is_correct', true);

    $this->get("/quiz/quizzes/{$quiz->id}/play")->assertOk();

    $response = $this->post("/quiz/quizzes/{$quiz->id}/attempts", [
        'answers' => [['question_id' => $question->id, 'answer_id' => $correct->id]],
    ]);

    $attempt = QuizAttempt::firstOrFail();
    expect($attempt->user_id)->toBeNull()
        ->and($attempt->guest_token)->not->toBeNull()
        ->and($attempt->percentage)->toBe(100);

    $response->assertRedirect(route('quiz-attempts.show', $attempt));
    $this->get(route('quiz-attempts.show', $attempt))
        ->assertOk()
        ->assertInertia(fn ($page) => $page->component('Quizzes/Results')->where('attempt.percentage', 100));

    // another visitor (new session) cannot open it
    $this->flushSession();
    $this->get(route('quiz-attempts.show', $attempt))->assertForbidden();
    // nor can another signed-in user
    $this->actingAs(User::factory()->create())->get(route('quiz-attempts.show', $attempt))->assertForbidden();
});

test('creating and personal pages still need an account', function () {
    $this->get('/quiz/quizzes/create')->assertRedirect(route('login'));
    $this->get('/quiz/my-quizzes')->assertRedirect(route('login'));
    $this->get('/profile')->assertRedirect(route('login'));
    $this->get('/friends')->assertRedirect(route('login'));
    $this->get('/mafia/history')->assertRedirect(route('login'));
    $this->post('/mafia/rooms')->assertRedirect(route('login'));
});

test('the Mafia section is public and lists only rooms without a password', function () {
    $open = MafiaRoom::factory()->create(['status' => 'lobby']);
    MafiaRoom::factory()->create(['status' => 'lobby', 'settings' => ['password_hash' => 'x']]);
    MafiaRoom::factory()->create(['status' => 'game_over']);

    $this->get('/mafia')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('Mafia/Index')
            ->has('rooms', 1)
            ->where('rooms.0.code', $open->room_code)
            ->where('rooms.0.status', 'lobby'));
});

test('the platform home carries the same public lists', function () {
    $quiz = publishedQuiz();
    $room = MafiaRoom::factory()->create(['status' => 'lobby']);

    $this->get('/')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('Home')
            ->where('games.0.key', 'quiz')
            ->where('games.0.items.0.title', $quiz->title)
            ->where('games.1.key', 'mafia')
            ->where('games.1.items.0.title', $room->room_code));
});

test('rooms with a signed-in viewer\'s friends are highlighted', function () {
    $viewer = User::factory()->create();
    $friend = User::factory()->create();
    \App\Models\FriendRequest::create(['sender_id' => $viewer->id, 'recipient_id' => $friend->id, 'status' => 'accepted']);

    $room = MafiaRoom::factory()->create(['status' => 'lobby']);
    \App\Models\MafiaPlayer::factory()->create(['mafia_room_id' => $room->id, 'user_id' => $friend->id, 'slot' => 1]);

    $this->actingAs($viewer)->get('/mafia')
        ->assertInertia(fn ($page) => $page->where('rooms.0.hasFriends', true));
});
