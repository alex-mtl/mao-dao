<?php

use App\Models\User;

test('a new user defaults to light-warm', function () {
    $user = User::factory()->create();

    // UserFactory deliberately doesn't set color_scheme, so the in-memory
    // model won't have it until refreshed — this is asserting the
    // database column default, not the factory.
    expect($user->fresh()->color_scheme)->toBe('light-warm');
});

test('color scheme is rejected when not supported', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->patch('/profile/color-scheme', [
        'color_scheme' => 'neon-pink',
    ]);

    $response->assertSessionHasErrors('color_scheme');
    expect($user->fresh()->color_scheme)->toBe('light-warm');
});

test('color scheme preference persists and is reflected on the next request', function () {
    $user = User::factory()->create(['color_scheme' => 'light-warm']);

    $this->actingAs($user)->patch('/profile/color-scheme', ['color_scheme' => 'dark-cool']);

    expect($user->fresh()->color_scheme)->toBe('dark-cool');

    $response = $this->actingAs($user)->get('/quiz');
    $response->assertInertia(fn ($page) => $page->where('color_scheme', 'dark-cool'));
});

test('the color scheme options shared to every page cover all six supported schemes', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->get('/quiz');

    $response->assertInertia(fn ($page) => $page
        ->has('color_scheme_options', 6)
        ->where('color_scheme_options.5.value', 'dark-neon')
        ->where('color_scheme_options.5.is_dark', true)
        ->where('color_scheme_options.3.value', 'dark-warm')
        ->where('color_scheme_options.3.is_dark', true)
        ->where('color_scheme_options.0.is_dark', false)
    );
});

test('a guest sees the neon scheme by default, a member keeps their saved one', function () {
    $this->get('/')
        ->assertOk()
        ->assertSee('data-theme="dark-neon"', false)
        ->assertInertia(fn ($page) => $page->where('color_scheme', 'dark-neon'));

    $user = User::factory()->create(['color_scheme' => 'light-warm']);
    $this->actingAs($user)->get('/')
        ->assertSee('data-theme="light-warm"', false)
        ->assertInertia(fn ($page) => $page->where('color_scheme', 'light-warm'));
});

test('a newly registered account starts with the look the visitor was already seeing', function () {
    $this->post('/register', [
        'name' => 'Newcomer',
        'email' => 'newcomer@example.com',
        'password' => 'password-123',
        'password_confirmation' => 'password-123',
    ]);

    expect(User::where('email', 'newcomer@example.com')->firstOrFail()->color_scheme)->toBe('dark-neon');
});
