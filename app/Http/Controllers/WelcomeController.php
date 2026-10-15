<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The platform home page: a block per game with a way into its section and,
 * later, the rooms that can be joined right now. The live room lists are a
 * placeholder for now (`openRooms` is always empty).
 */
class WelcomeController extends Controller
{
    public function __invoke(): Response
    {
        $games = collect(config('games'))->map(fn (array $game, string $key) => [
            'key' => $key,
            'accent' => $game['accent'],
            'url' => route($game['route']),
            'createUrl' => $game['create'] ? route($game['create']) : null,
            // Template only: rooms open for joining, with who is in them and
            // which of the viewer's friends are there. Not wired up yet.
            'openRooms' => [],
        ])->values();

        return Inertia::render('Home', [
            'canLogin' => Route::has('login'),
            'canRegister' => Route::has('register'),
            'games' => $games,
        ]);
    }
}
