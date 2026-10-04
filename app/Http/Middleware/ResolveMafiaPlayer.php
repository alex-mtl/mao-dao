<?php

namespace App\Http\Middleware;

use App\Events\Mafia\MafiaPlayerConnectionChanged;
use App\Models\MafiaRoom;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the {code} route parameter to a MafiaRoom and, if the
 * authenticated user is seated in it, their MafiaPlayer too — directly
 * analogous to ResolveRacePlayer, but simpler: Mafia is accounts-only
 * (plan §3.1 #2), so identity is just `user_id`, not a session token.
 * Neither attribute is guaranteed non-null beyond the room itself:
 * controllers decide what to do when the user hasn't joined yet.
 */
class ResolveMafiaPlayer
{
    public function handle(Request $request, Closure $next): Response
    {
        $room = MafiaRoom::where('room_code', strtoupper((string) $request->route('code')))->first();

        abort_unless($room, 404);

        $player = $room->players()->where('user_id', $request->user()->id)->first();

        // A cheap heartbeat, mirroring ResolveRacePlayer's — mafia:tick
        // uses staleness here to detect an abandoned lobby, and (plan §8)
        // a disconnected in-game player. Simply reaching this line at all
        // is proof of connectivity, so a player mafia:tick had flagged
        // disconnected is immediately un-flagged the moment any of their
        // requests gets this far — there's no separate "reconnect" action.
        if ($player) {
            $wasDisconnected = $player->connection_status === 'disconnected';

            $player->update([
                'last_seen_at' => now(),
                'connection_status' => 'connected',
                'disconnected_at' => null,
            ]);

            if ($wasDisconnected) {
                MafiaPlayerConnectionChanged::dispatch($room, $player);
            }
        }

        $request->attributes->set('mafiaRoom', $room);
        $request->attributes->set('mafiaPlayer', $player);

        return $next($request);
    }
}
