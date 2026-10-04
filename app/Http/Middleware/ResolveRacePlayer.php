<?php

namespace App\Http\Middleware;

use App\Models\RaceRoom;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the {code} route parameter to a RaceRoom and, if the visitor's
 * session holds a valid Race Player token for that room, the RacePlayer
 * too — for both anonymous guests and authenticated users alike, since
 * Race identity is deliberately independent of the `auth` guard. Neither
 * attribute is guaranteed non-null: controllers decide what to do when a
 * room doesn't exist (404, handled here) or a player hasn't joined yet
 * (redirect to the join page, decided by the controller).
 */
class ResolveRacePlayer
{
    public function handle(Request $request, Closure $next): Response
    {
        $room = RaceRoom::where('room_code', strtoupper((string) $request->route('code')))->first();

        abort_unless($room, 404);

        $token = $request->session()->get("race_player_token.{$room->id}");

        $player = $token
            ? $room->players()->where('session_token', $token)->first()
            : null;

        // A cheap heartbeat: any authenticated Race request from this
        // player (including the periodic ping in useRaceChannel.js) keeps
        // them "seen", which race:tick uses to detect a silently
        // disconnected host and cancel an abandoned lobby.
        $player?->update(['last_seen_at' => now()]);

        $request->attributes->set('raceRoom', $room);
        $request->attributes->set('racePlayer', $player);

        return $next($request);
    }
}
