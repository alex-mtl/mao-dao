<?php

declare(strict_types=1);

namespace App\Games\Guessword\Http\Controllers;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Capabilities;
use App\Services\ClientAccounts;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The streamer app (stream-client/): it sends the access key of a client account
 * (App\Services\ClientAccounts) and gets a one-time address that signs its window in to the room,
 * plus the overlay link it hands to OBS / TikTok LIVE Studio from http://localhost.
 */
class ClientController extends Controller
{
    public function __construct(private ClientAccounts $clients, private Capabilities $capabilities) {}

    public function session(Request $request): JsonResponse
    {
        $user = $this->userForKey($request);
        if ($user instanceof JsonResponse) {
            return $user;
        }

        return response()->json([
            'name' => $user->name,
            'enterUrl' => route('guessword.client.enter', $this->clients->loginCode($user)),
            'overlayUrl' => $this->room($user)->overlayUrl(),
        ]);
    }

    public function overlay(Request $request): JsonResponse
    {
        $user = $this->userForKey($request);

        return $user instanceof JsonResponse ? $user : response()->json(['overlayUrl' => $this->room($user)->overlayUrl()]);
    }

    public function enter(Request $request, string $code): RedirectResponse|Response
    {
        $user = $this->clients->userForCode($code);
        if (! $user) {
            return Inertia::render('Guessword/ClientSignedOut');
        }
        Auth::guard('web')->login($user, remember: true);
        $request->session()->regenerate();

        return redirect()->route('guessword.room');
    }

    private function userForKey(Request $request): User|JsonResponse
    {
        $user = $this->clients->userForKey((string) $request->input('key', ''));
        if (! $user) {
            return response()->json(['error' => 'bad_key'], 401);
        }
        if (! $this->capabilities->allows($user, Capabilities::GUESSWORD_TIKTOK)) {
            return response()->json(['error' => 'no_access'], 403);
        }

        return $user;
    }

    private function room(User $user): GuesswordRoom
    {
        return GuesswordRoom::firstOrCreate(['user_id' => $user->id], ['lang' => 'ru']);
    }
}
