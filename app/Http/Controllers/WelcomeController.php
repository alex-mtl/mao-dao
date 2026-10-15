<?php

namespace App\Http\Controllers;

use App\Models\Quiz;
use App\Services\MafiaRoomListService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The platform home page: a block per game with a way into its section and a
 * short list of what can be entered right now (open Mafia rooms, newest
 * quizzes). Everything on it is public.
 */
class WelcomeController extends Controller
{
    public function __invoke(Request $request, MafiaRoomListService $mafiaRooms): Response
    {
        $viewer = $request->user();

        $games = collect(config('games'))->map(function (array $game, string $key) use ($viewer, $mafiaRooms) {
            $items = match ($key) {
                'mafia' => $mafiaRooms->publicRooms($viewer, 5)->map(fn (array $room) => [
                    'kind' => 'room',
                    'title' => $room['code'],
                    'players' => $room['players'],
                    'playersCount' => $room['playersCount'],
                    'seats' => $room['seats'],
                    'status' => $room['status'],
                    'hasFriends' => $room['hasFriends'],
                    'url' => $room['url'],
                ])->all(),
                'quiz' => Quiz::query()->published()->orderByDesc('published_at')->limit(4)->get(['id', 'title'])
                    ->map(fn (Quiz $quiz) => [
                        'kind' => 'quiz',
                        'title' => $quiz->title,
                        'url' => route('quizzes.show', $quiz),
                    ])->all(),
                default => [],
            };

            return [
                'key' => $key,
                'accent' => $game['accent'],
                'url' => route($game['route']),
                'createUrl' => $game['create'] ? route($game['create']) : null,
                'items' => $items,
            ];
        })->values();

        return Inertia::render('Home', [
            'canLogin' => Route::has('login'),
            'canRegister' => Route::has('register'),
            'games' => $games,
        ]);
    }
}
