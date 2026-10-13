<?php

use App\Models\User;

test('an unknown address renders the styled 404 page with the site shared props', function () {
    $this->get('/definitely/not/here')
        ->assertNotFound()
        ->assertInertia(fn ($page) => $page->component('Error')->where('status', 404)->has('auth'));
});

test('a signed-in visitor gets the same styled 404', function () {
    $this->actingAs(User::factory()->create())->get('/nope')
        ->assertNotFound()
        ->assertInertia(fn ($page) => $page->component('Error')->where('status', 404));
});

test('a mafia address that leads nowhere explains it instead of showing a bare 404', function () {
    $this->get('/mafia/NOROOM/watch')
        ->assertNotFound()
        ->assertInertia(fn ($page) => $page->component('Mafia/RoomUnavailable')->where('code', 'NOROOM'));
});

test('JSON requests still get a JSON error', function () {
    $this->getJson('/nope')->assertNotFound()->assertJsonStructure(['message']);
});

test('a signed-out visitor opening the play address of a missing room sees the missing-game page, not a login form', function () {
    $this->get('/mafia/NOROOM/play')->assertRedirect(route('mafia.show', 'NOROOM'));
    $this->get('/mafia/NOROOM/lobby')->assertRedirect(route('mafia.show', 'NOROOM'));
});

test('a signed-out visitor opening the play address of a real room is still asked to log in', function () {
    $room = \App\Models\MafiaRoom::factory()->create();

    $this->get("/mafia/{$room->room_code}/play")->assertRedirect(route('login'));
});
