<?php

use App\Models\MafiaRoom;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});

/**
 * Scaffolding for Mafia's hidden information (dealt role, Don/Sheriff
 * check results, ...) — see the "Mafia Extension" plan §5.1. Nothing
 * broadcasts on this channel yet (Phase 2 only needs the public
 * mafia.{roomCode} channel), but the auth callback is wired up now so
 * Phase 3's private reveals don't need any new plumbing, only new events.
 */
Broadcast::channel('mafia.{roomCode}.player.{mafiaPlayerId}', function ($user, $roomCode, $mafiaPlayerId) {
    $room = MafiaRoom::where('room_code', strtoupper($roomCode))->first();

    return $room && $room->players()
        ->where('id', $mafiaPlayerId)
        ->where('user_id', $user->id)
        ->exists();
});
