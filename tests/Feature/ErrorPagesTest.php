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
