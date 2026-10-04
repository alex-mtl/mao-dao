<?php

use App\Events\Mafia\MafiaRoomCancelled;
use App\Models\MafiaRoom;
use App\Services\Mafia\MafiaTickService;
use Illuminate\Support\Facades\Event;

test('mafia:tick cancels a lobby whose game-host has gone silent', function () {
    Event::fake([MafiaRoomCancelled::class]);
    $room = MafiaRoom::factory()->create(['status' => 'lobby']);
    $room->players()->create([
        'user_id' => $room->host_user_id,
        'slot' => 1,
        'is_game_host' => true,
        'joined_at' => now()->subMinute(),
        'last_seen_at' => now()->subSeconds(config('mafia.lobby_host_disconnect_timeout_seconds') + 5),
    ]);

    app(MafiaTickService::class)->tick();

    expect($room->fresh()->status)->toBe('cancelled');
    Event::assertDispatched(MafiaRoomCancelled::class);
});

test('mafia:tick does not cancel a lobby whose game-host was recently seen', function () {
    $room = MafiaRoom::factory()->create(['status' => 'lobby']);
    $room->players()->create([
        'user_id' => $room->host_user_id,
        'slot' => 1,
        'is_game_host' => true,
        'joined_at' => now(),
        'last_seen_at' => now(),
    ]);

    app(MafiaTickService::class)->tick();

    expect($room->fresh()->status)->toBe('lobby');
});
