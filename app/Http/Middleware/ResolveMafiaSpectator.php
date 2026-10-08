<?php

namespace App\Http\Middleware;

use App\Events\Mafia\MafiaActionRecorded;
use App\Events\Mafia\MafiaLobbyUpdated;
use App\Models\MafiaRoom;
use App\Models\MafiaSpectator;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the {code} room and the *spectator* making the request —
 * registered or guest. Counterpart of ResolveMafiaPlayer for the public
 * watch routes (no `auth` guard): a logged-in user is identified by their
 * account, a guest by a random token kept in their session. A spectator row
 * is created on first sight (up to the per-room limit) and its heartbeat
 * refreshed on every request, which is also how the "spectators" strip
 * knows who is still there.
 */
class ResolveMafiaSpectator
{
    public function handle(Request $request, Closure $next): Response
    {
        $room = MafiaRoom::where('room_code', strtoupper((string) $request->route('code')))->first();

        abort_unless($room, 404);

        $user = $request->user();

        // A seated player uses their own pages; nothing to resolve here.
        if ($user && $room->players()->where('user_id', $user->id)->exists()) {
            $request->attributes->set('mafiaRoom', $room);
            $request->attributes->set('mafiaSpectator', null);

            return $next($request);
        }

        if ($user) {
            $identity = ['user_id' => $user->id];
        } else {
            $token = $request->session()->get('mafia_spectator_token');
            if (! $token) {
                $token = Str::random(40);
                $request->session()->put('mafia_spectator_token', $token);
            }
            $identity = ['session_token' => $token];
        }

        $spectator = $room->spectators()->where($identity)->first();

        if (! $spectator) {
            // Recently-seen viewers count against the limit, stale rows don't.
            $current = $room->spectators()->active()->count();
            abort_if($current >= config('mafia.spectator_limit'), 429, __('mafia.spectator_limit_reached'));

            $spectator = $room->spectators()->create([...$identity, 'last_seen_at' => now()]);

            // Tell everyone already in the room someone arrived.
            $room->status === 'lobby'
                ? MafiaLobbyUpdated::dispatch($room->fresh())
                : MafiaActionRecorded::dispatch($room);
        } else {
            $spectator->update(['last_seen_at' => now()]);
        }

        $request->attributes->set('mafiaRoom', $room);
        $request->attributes->set('mafiaSpectator', $spectator);

        return $next($request);
    }
}
