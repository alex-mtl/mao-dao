<?php

use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;
use App\Models\User;

test('a finished game the user played in appears in their history with the correct result', function () {
    $user = User::factory()->create();
    $room = MafiaRoom::factory()->finished('red')->create();
    $room->players()->create([
        'user_id' => $user->id, 'slot' => 1, 'role' => 'sheriff', 'status' => 'alive', 'joined_at' => now(),
    ]);

    $response = $this->actingAs($user)->get('/mafia/history');

    $response->assertInertia(fn ($page) => $page
        ->component('Mafia/History')
        ->where('games.data.0.roomCode', $room->room_code)
        ->where('games.data.0.role', 'sheriff')
        ->where('games.data.0.won', true)
    );
});

test('a lost game shows won as false', function () {
    $user = User::factory()->create();
    $room = MafiaRoom::factory()->finished('black')->create();
    $room->players()->create([
        'user_id' => $user->id, 'slot' => 1, 'role' => 'sheriff', 'status' => 'killed', 'joined_at' => now(),
    ]);

    $response = $this->actingAs($user)->get('/mafia/history');

    $response->assertInertia(fn ($page) => $page->where('games.data.0.won', false));
});

test('a room that was only cancelled never appears in history', function () {
    $user = User::factory()->create();
    $room = MafiaRoom::factory()->create(['status' => 'cancelled']);
    $room->players()->create(['user_id' => $user->id, 'slot' => 1, 'joined_at' => now()]);

    $response = $this->actingAs($user)->get('/mafia/history');

    $response->assertInertia(fn ($page) => $page->where('games.data', []));
});

test('another user\'s finished games do not appear in your history', function () {
    $user = User::factory()->create();
    $otherUser = User::factory()->create();
    $room = MafiaRoom::factory()->finished('red')->create();
    $room->players()->create(['user_id' => $otherUser->id, 'slot' => 1, 'role' => 'citizen', 'joined_at' => now()]);

    $response = $this->actingAs($user)->get('/mafia/history');

    $response->assertInertia(fn ($page) => $page->where('games.data', []));
});
