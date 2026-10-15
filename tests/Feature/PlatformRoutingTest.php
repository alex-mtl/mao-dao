<?php

use App\Models\User;

test('the platform home lists a block for every game, for guests and members alike', function () {
    $this->get('/')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('Home')
            ->has('games', 2)
            ->where('games.0.key', 'quiz')
            ->where('games.1.key', 'mafia')
            ->where('games.0.openRooms', [])
            ->where('canRegister', true));

    $this->actingAs(User::factory()->create())->get('/')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->component('Home'));
});

test('the quiz section lives under /quiz, with the dashboard at its root', function () {
    $this->get('/quiz')->assertRedirect(route('login'));

    $user = User::factory()->create();

    $this->actingAs($user)->get('/quiz')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->component('Dashboard'));

    expect(route('dashboard', absolute: false))->toBe('/quiz')
        ->and(route('library.index', absolute: false))->toBe('/quiz/library')
        ->and(route('quizzes.mine', absolute: false))->toBe('/quiz/my-quizzes')
        ->and(route('login', absolute: false))->toBe('/login')
        ->and(route('profile.edit', absolute: false))->toBe('/profile')
        ->and(route('mafia.index', absolute: false))->toBe('/mafia');
});

test('old /quiz/... addresses of platform pages redirect to the domain root', function () {
    $this->get('/quiz/login')->assertStatus(301)->assertRedirect('/login');
    $this->get('/quiz/register')->assertStatus(301)->assertRedirect('/register');
    $this->get('/quiz/profile?tab=1')->assertStatus(301)->assertRedirect('/profile?tab=1');
    $this->get('/quiz/groups/12')->assertStatus(301)->assertRedirect('/groups/12');
    $this->get('/quiz/dashboard')->assertStatus(301)->assertRedirect('/quiz');
});

test('addresses that external parties already hold keep answering', function () {
    // signed confirmation link and OAuth callback of the old mount point
    $this->get('/quiz/verify-email/1/abc')->assertForbidden(); // route exists, signature missing
    // the media sidecar's configured base URL
    $this->get('/quiz/internal/mafia/mic-policy')->assertForbidden(); // route exists, shared secret missing
});
