<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A client account (App\Services\ClientAccounts) lives only inside the streamer app: its room and
 * what the room page uses. Any other page of the site sends it back to the room.
 */
class RestrictClientAccounts
{
    private const ALLOWED = [
        'guessword.room', 'guessword.room.*',
        'guessword.archive', 'guessword.archive.*',
        'guessword.avatar',
        'guessword.client.*',
        // the app's Language / Theme menus
        'profile.language.update', 'profile.color-scheme.update',
        'logout',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->user()?->client_only && ! $request->routeIs(...self::ALLOWED)) {
            abort_unless($request->isMethod('GET'), 403);

            return redirect()->route('guessword.room');
        }

        return $next($request);
    }
}
