<?php

declare(strict_types=1);

namespace App\Games\Guessword\Http\Controllers;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Services\EngineClient;
use App\Games\Guessword\Services\LiveArchive;
use App\Http\Controllers\Controller;
use App\Services\Capabilities;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response as HttpResponse;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

/**
 * The streamer's archive of LIVEs ("Live logs" in docs/games/guessword.md) and what the browser needs to
 * build the "champion race" digest from the streamer's own recording (the video never comes here).
 * Same access as the room: the streamer's own room, any room for super admins.
 */
class ArchiveController extends Controller
{
    public function __construct(
        private LiveArchive $archive,
        private EngineClient $engine,
        private Capabilities $capabilities,
    ) {}

    public function index(Request $request, ?GuesswordRoom $room = null): Response
    {
        $room = $this->roomFor($request, $room);
        try {
            $lives = $this->archive->lives($room);
        } catch (Throwable $e) {
            report($e);
            $lives = null;
        }

        return Inertia::render('Guessword/Archive', [
            'room' => [
                'id' => $room->id,
                'foreign' => $room->user_id !== $request->user()->id ? $room->user()->value('name') : null,
                'tiktok' => $room->tiktok_username,
            ],
            'lives' => $lives ?? [],
            'engineOnline' => $lives !== null,
        ]);
    }

    /** the digest's events of one LIVE (JSON array of the log's objects) */
    public function events(Request $request, string $file, ?GuesswordRoom $room = null): JsonResponse
    {
        $room = $this->roomFor($request, $room);
        abort_unless(preg_match('/^[\w.-]+\.jsonl$/', $file) === 1, 404);
        $events = $this->archive->events($room, $file);
        abort_if($events === null, 404);

        return response()->json($events);
    }

    /** super admins: the same for any room (/guessword/rooms/{room}/archive/lives/{file}) */
    public function roomEvents(Request $request, GuesswordRoom $room, string $file): JsonResponse
    {
        return $this->events($request, $file, $room);
    }

    /** a viewer's avatar for the digest (the engine keeps them; TikTok's own links expire) */
    public function avatar(Request $request, string $key): HttpResponse
    {
        abort_unless($this->capabilities->allows($request->user(), Capabilities::GUESSWORD_TIKTOK), 403);
        abort_unless(preg_match('/^[A-Za-z0-9_.]{1,64}$/', $key) === 1, 404);
        $pic = $this->engine->avatar($key);
        abort_if($pic === null, 404);

        return response($pic[0], 200, ['Content-Type' => $pic[1], 'Cache-Control' => 'private, max-age=86400']);
    }

    private function roomFor(Request $request, ?GuesswordRoom $room): GuesswordRoom
    {
        $user = $request->user();
        if ($room) {
            abort_unless($user->isSuperAdmin(), 403);

            return $room;
        }
        abort_unless($this->capabilities->allows($user, Capabilities::GUESSWORD_TIKTOK), 403);

        return GuesswordRoom::firstOrCreate(['user_id' => $user->id], ['lang' => 'ru']);
    }
}
