<?php

use App\Models\Quiz;
use App\Models\User;

test('guests get english by default', function () {
    $response = $this->get('/login');

    $response->assertInertia(fn ($page) => $page->where('locale', 'en'));
});

test('a new user defaults to english', function () {
    $user = User::factory()->create();

    // UserFactory deliberately doesn't set ui_language, so the in-memory
    // model won't have it until refreshed — this is asserting the
    // database column default, not the factory.
    expect($user->fresh()->ui_language)->toBe('en');
});

test('ui language is rejected when not supported', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->patch('/profile/language', [
        'ui_language' => 'xx',
    ]);

    $response->assertSessionHasErrors('ui_language');
    expect($user->fresh()->ui_language)->toBe('en');
});

test('ui language preference persists and is reflected on the next request', function () {
    $user = User::factory()->create(['ui_language' => 'en']);

    $this->actingAs($user)->patch('/profile/language', ['ui_language' => 'fr']);

    expect($user->fresh()->ui_language)->toBe('fr');

    $response = $this->actingAs($user)->get('/dashboard');
    $response->assertInertia(fn ($page) => $page->where('locale', 'fr'));
});

test('changing ui language does not change an existing quiz language', function () {
    $user = User::factory()->create(['ui_language' => 'en']);
    $quiz = Quiz::factory()->create(['user_id' => $user->id, 'language' => 'en']);

    $this->actingAs($user)->patch('/profile/language', ['ui_language' => 'fr']);

    expect($quiz->fresh()->language)->toBe('en');
});

test('the create-quiz page shares the current user so the editor can default the quiz language to it', function () {
    $user = User::factory()->create(['ui_language' => 'ru']);

    $response = $this->actingAs($user)->get('/quizzes/create');

    // The Editor page defaults its quiz-language <select> from this shared
    // prop client-side (see resources/js/Pages/Quizzes/Editor.jsx); this
    // confirms the value it depends on is actually present and correct.
    $response->assertInertia(fn ($page) => $page->where('auth.user.ui_language', 'ru'));
});

test('a quiz stores whatever language is submitted, independent of the request', function () {
    $user = User::factory()->create(['ui_language' => 'ru']);

    $this->actingAs($user)->post('/quizzes', [
        'title' => 'Test Quiz',
        'language' => 'ru',
        'allow_copying' => true,
        'tag_ids' => [],
        'questions' => [],
    ]);

    $quiz = Quiz::where('title', 'Test Quiz')->first();
    expect($quiz->language)->toBe('ru');
});
