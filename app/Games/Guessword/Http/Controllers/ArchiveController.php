<?php

declare(strict_types=1);

namespace App\Games\Guessword\Http\Controllers;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Services\EngineClient;
use App\Games\Guessword\Services\LiveArchive;
use App\Games\Guessword\Models\GuesswordRound;
use App\Games\Guessword\Services\RoundsArchive;
use App\Games\Guessword\Services\SpeechArchive;
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
        private RoundsArchive $rounds,
        private SpeechArchive $speech,
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
        // the rounds table follows the logs (only LIVEs whose log grew are read again)
        try {
            if ($lives !== null) {
                $this->rounds->sync($room);
            }
        } catch (Throwable $e) {
            report($e);
        }

        return Inertia::render('Guessword/Archive', [
            'room' => [
                'id' => $room->id,
                'foreign' => $room->user_id !== $request->user()->id ? $room->user()->value('name') : null,
                'tiktok' => $room->tiktok_username,
            ],
            'lives' => $lives ?? [],
            // LIVEs older than the logs, known from their recordings (guessword:rounds-import)
            'recorded' => $this->rounds->recordedOnly($room, array_column($lives ?? [], 'file')),
            // per LIVE: [[seconds, reason, 1 = clip / 2 = moments], ...] for the strip of rounds
            'strips' => (object) $this->rounds->strips($room),
            // LIVEs whose speech is loaded: their rounds get the "make a clip" button
            'speech' => $this->speech->keys($room),
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

    /** every round of one LIVE (the round table under a LIVE of the archive) */
    public function rounds(Request $request, string $live, ?GuesswordRoom $room = null): JsonResponse
    {
        $room = $this->roomFor($request, $room);
        abort_unless(preg_match('/^[\w.:-]{1,120}$/', $live) === 1, 404);

        return response()->json($this->rounds->rounds($room, $live));
    }

    /**
     * What the clip form of one round needs: the round (its place in the LIVE, length, winner) and the host's words
     * from shortly before it to ~2.5 minutes after its end (the remarks to choose from).
     */
    public function speech(Request $request, string $live, int $round, ?GuesswordRoom $room = null): JsonResponse
    {
        $room = $this->roomFor($request, $room);
        abort_unless(preg_match('/^[\w.:-]{1,120}$/', $live) === 1, 404);
        $row =GuesswordRound::where('room_id', $room->id)->where('live_key', $live)->where('round', $round)->first();
        abort_if($row === null || $row->offset_s === null || $row->duration_s === null, 404);
        $slice = $this->speech->slice($room, $live, $row->offset_s - 10, $row->offset_s + $row->duration_s + 150);
        abort_if($slice === null, 404);

        return response()->json([
            'round' => [
                'round' => $row->round, 'word' => $row->word, 'offset' => $row->offset_s, 'duration' => $row->duration_s,
                'winner' => $row->winner_name, 'winnerId' => $row->winner_id, 'winnerUid' => $row->winner_uid, 'reason' => $row->reason,
            ],
            'words' => $slice['words'],
            'shift' => $slice['shift'],
        ]);
    }

    /** super admins: the same for any room */
    public function roomSpeech(Request $request, GuesswordRoom $room, string $live, int $round): JsonResponse
    {
        return $this->speech($request, $live, $round, $room);
    }

    /** super admins: rounds of any room */
    public function roomRounds(Request $request, GuesswordRoom $room, string $live): JsonResponse
    {
        return $this->rounds($request, $live, $room);
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
