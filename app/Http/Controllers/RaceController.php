<?php

namespace App\Http\Controllers;

use App\Events\Race\RaceCancelled;
use App\Events\Race\RacePlayAgain;
use App\Events\Race\RacePlayerJoined;
use App\Events\Race\RaceStarted;
use App\Models\Quiz;
use App\Models\RacePlayer;
use App\Models\RaceRoom;
use App\Services\RaceScoringService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class RaceController extends Controller
{
    /**
     * Host creates a Race Room for a quiz they're allowed to view/play.
     * Mirrors QuizAttemptController::play()'s authorization: respects the
     * same visibility policy and the same published-only rule.
     */
    public function store(Request $request, Quiz $quiz): RedirectResponse
    {
        $this->authorize('view', $quiz);
        abort_unless($quiz->isPublished(), 404);

        RaceRoom::deleteStaleFinishedRooms();

        $room = $this->createRoomWithHost($quiz->id, $request);

        return redirect()->route('race.lobby', $room->room_code);
    }

    /**
     * Host-only, finished rooms only. Creates a brand NEW Race Room for
     * the same quiz — the finished room is never reset/reused/mutated,
     * so its recorded scores/answers stay a consistent historical record.
     * Broadcasts on the OLD room's channel so players still viewing its
     * final-results screen can follow the host into the new one.
     */
    public function playAgain(Request $request): RedirectResponse
    {
        $oldRoom = $request->attributes->get('raceRoom');
        $player = $request->attributes->get('racePlayer');

        abort_unless($player && $player->is_host, 403);
        abort_unless($oldRoom->status === 'finished', 409);

        $newRoom = $this->createRoomWithHost($oldRoom->quiz_id, $request);

        RacePlayAgain::dispatch($oldRoom, $newRoom);

        return redirect()->route('race.lobby', $newRoom->room_code);
    }

    private function createRoomWithHost(int $quizId, Request $request): RaceRoom
    {
        return DB::transaction(function () use ($quizId, $request) {
            $room = RaceRoom::create([
                'quiz_id' => $quizId,
                'host_user_id' => $request->user()->id,
                'room_code' => RaceRoom::generateUniqueRoomCode(),
                'status' => 'lobby',
                'max_players' => config('race.default_max_players'),
            ]);

            $this->createPlayer($room, $request, mb_substr($request->user()->name, 0, 20), isHost: true);

            return $room;
        });
    }

    /**
     * Public entry point for an invitation link. Renders the appropriate
     * state (joinable / full / already started / finished / cancelled /
     * not found) for a visitor who hasn't joined yet, or sends someone
     * who already has a Race Player identity in this browser straight to
     * the lobby.
     */
    public function show(Request $request, string $code): Response|RedirectResponse
    {
        $room = RaceRoom::where('room_code', strtoupper($code))->with('quiz:id,title')->first();

        if (! $room) {
            return Inertia::render('Race/Join', [
                'state' => 'not_found',
                'code' => strtoupper($code),
            ]);
        }

        if ($this->resolvePlayer($request, $room)) {
            return redirect()->route(
                $room->status === 'lobby' ? 'race.lobby' : 'race.play',
                $room->room_code,
            );
        }

        $playerCount = $room->players()->count();

        $state = match (true) {
            $room->status === 'finished' => 'finished',
            $room->status === 'cancelled' => 'cancelled',
            $room->status !== 'lobby' => 'started',
            $playerCount >= $room->max_players => 'full',
            default => 'joinable',
        };

        return Inertia::render('Race/Join', [
            'state' => $state,
            'code' => $room->room_code,
            'quizTitle' => $room->quiz->title,
            'playerCount' => $playerCount,
            'maxPlayers' => $room->max_players,
        ]);
    }

    /**
     * Anonymous or authenticated join with a temporary, per-race nickname
     * — independent of the account name for authenticated users, and
     * never persisted anywhere but this RacePlayer row.
     */
    public function join(Request $request, string $code): RedirectResponse
    {
        $room = RaceRoom::where('room_code', strtoupper($code))->firstOrFail();

        $validated = $request->validate([
            'nickname' => ['required', 'string', 'min:2', 'max:20'],
        ]);

        // An authenticated user re-submitting the join form for a room
        // they're already in just resumes their existing identity.
        if ($request->user()) {
            $existing = $room->players()->where('user_id', $request->user()->id)->first();
            if ($existing) {
                $request->session()->put("race_player_token.{$room->id}", $existing->session_token);

                return redirect()->route('race.lobby', $room->room_code);
            }
        }

        if (! $room->isJoinable()) {
            return back()->withErrors(['nickname' => __('race.room_full_or_started')]);
        }

        $nicknameTaken = $room->players()
            ->whereRaw('LOWER(nickname) = ?', [mb_strtolower($validated['nickname'])])
            ->exists();

        if ($nicknameTaken) {
            return back()->withErrors(['nickname' => __('race.nickname_taken')]);
        }

        $this->createPlayer($room, $request, $validated['nickname'], isHost: false);

        return redirect()->route('race.lobby', $room->room_code);
    }

    public function lobby(Request $request): Response|RedirectResponse
    {
        $room = $request->attributes->get('raceRoom');
        $player = $request->attributes->get('racePlayer');

        if (! $player) {
            return redirect()->route('race.show', $room->room_code);
        }

        if ($room->status !== 'lobby') {
            return redirect()->route('race.play', $room->room_code);
        }

        $room->load('quiz:id,title');
        $players = $room->players()->orderBy('joined_at')->get(['id', 'nickname', 'is_host']);

        return Inertia::render('Race/Lobby', [
            'room' => [
                'code' => $room->room_code,
                'status' => $room->status,
                'maxPlayers' => $room->max_players,
                'quizTitle' => $room->quiz->title,
            ],
            'players' => $players->map(fn ($p) => [
                'id' => $p->id,
                'nickname' => $p->nickname,
                'isHost' => $p->is_host,
            ]),
            'isHost' => $player->is_host,
            'inviteUrl' => route('race.show', $room->room_code),
        ]);
    }

    /**
     * Host-only. Snapshots the quiz's current question order onto the
     * room so a later edit to the quiz can't corrupt an in-progress race,
     * then flips the room into `starting` with an authoritative "go at"
     * timestamp. The countdown -> question -> ... state machine from here
     * on is driven entirely by the race:tick worker, not by requests.
     */
    public function start(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('raceRoom');
        $player = $request->attributes->get('racePlayer');

        abort_unless($player && $player->is_host, 403);

        // A benign timing race (e.g. a double-click before the button's
        // own disabled state applies, or the room having just moved on
        // via a still-in-flight earlier click) rather than a real error —
        // send the host wherever the room already is instead of a raw
        // error page.
        if ($room->status !== 'lobby') {
            return redirect()->route('race.lobby', $room->room_code);
        }

        $questionIds = $room->quiz->questions()->pluck('id')->all();
        abort_if(empty($questionIds), 422);

        $room->update([
            'status' => 'starting',
            'question_order' => $questionIds,
            'started_at' => now()->addSeconds(config('race.countdown_seconds')),
        ]);

        RaceStarted::dispatch($room);

        return redirect()->route('race.lobby', $room->room_code);
    }

    public function play(Request $request): Response|RedirectResponse
    {
        $room = $request->attributes->get('raceRoom');
        $player = $request->attributes->get('racePlayer');

        if (! $player) {
            return redirect()->route('race.show', $room->room_code);
        }

        if ($room->status === 'lobby') {
            return redirect()->route('race.lobby', $room->room_code);
        }

        $room->load('quiz:id,title');

        return Inertia::render('Race/Play', array_merge(
            [
                'code' => $room->room_code,
                'quizTitle' => $room->quiz->title,
                'questionTimeLimitSeconds' => config('race.question_time_limit_seconds'),
            ],
            $this->roomSnapshot($room, $player),
        ));
    }

    /**
     * A JSON snapshot of the room, shaped identically to what the
     * broadcast events send — used for initial page hydration and for
     * resyncing if the WebSocket connection drops and reconnects. This is
     * a deliberate complement to the socket, not a second real-time
     * architecture: the socket is what drives live updates.
     */
    public function state(Request $request): JsonResponse
    {
        $room = $request->attributes->get('raceRoom');
        $player = $request->attributes->get('racePlayer');

        abort_unless($player, 403);

        return response()->json($this->roomSnapshot($room, $player));
    }

    /**
     * Exactly one answer per player per question, validated entirely from
     * server-recorded state: the active question comes from the room's
     * own snapshot (not anything the client claims), correctness is
     * looked up server-side, the response time is measured from the
     * server's own `current_question_started_at`, and a submission past
     * the server's stored deadline is rejected outright — the client
     * never supplies a time, a score, or a correctness flag.
     */
    public function answer(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('raceRoom');
        $player = $request->attributes->get('racePlayer');

        abort_unless($player, 403);

        // The question can legitimately have already ended server-side by
        // the time this request arrives — race:tick polls every 500ms, so
        // an answer clicked right at the buzzer can lose that race. That's
        // normal, not an error: send the player back to Play, where the
        // socket (or a fresh load) already reflects the real current
        // state, rather than showing a raw error page for a timing race.
        if ($room->status !== 'question') {
            return redirect()->route('race.play', $room->room_code);
        }

        $question = $room->currentQuestion();
        abort_unless($question, 404);

        $validated = $request->validate([
            'answer_id' => ['required', 'integer'],
        ]);

        $alreadyAnswered = $player->answers()->where('question_id', $question->id)->exists();
        if ($alreadyAnswered) {
            return redirect()->route('race.play', $room->room_code);
        }

        if ($room->current_question_deadline_at && now()->greaterThan($room->current_question_deadline_at)) {
            return redirect()->route('race.play', $room->room_code)
                ->withErrors(['answer_id' => __('race.answer_too_late')]);
        }

        $chosenAnswer = $question->answers->firstWhere('id', (int) $validated['answer_id']);
        $isCorrect = (bool) $chosenAnswer?->is_correct;
        $responseTimeMs = $room->current_question_started_at
            ? (int) round($room->current_question_started_at->diffInMilliseconds(now(), absolute: true))
            : 0;
        $timeLimitMs = config('race.question_time_limit_seconds') * 1000;
        $points = app(RaceScoringService::class)->score($isCorrect, $responseTimeMs, $timeLimitMs);

        DB::transaction(function () use ($player, $question, $chosenAnswer, $isCorrect, $responseTimeMs, $points) {
            $player->answers()->create([
                'question_id' => $question->id,
                'answer_id' => $chosenAnswer?->id,
                'is_correct' => $isCorrect,
                'response_time_ms' => $responseTimeMs,
                'points' => $points,
            ]);

            $player->increment('score', $points);
        });

        return redirect()->route('race.play', $room->room_code);
    }

    /**
     * The host leaving before the race starts cancels the room outright
     * (the simplest robust option — no host-transfer bookkeeping). Once a
     * race is running, the state machine is entirely server/race:tick
     * driven and independent of any single player's connection, so
     * leaving mid-race never cancels anything — it just removes that
     * player. Leaving is a hard delete of the Race Player row; there's no
     * pre-game answer/score history to preserve.
     */
    public function leave(Request $request): RedirectResponse
    {
        $room = $request->attributes->get('raceRoom');
        $player = $request->attributes->get('racePlayer');

        if ($player) {
            $wasHost = $player->is_host;
            $player->delete();
            $request->session()->forget("race_player_token.{$room->id}");

            if ($wasHost && $room->status === 'lobby') {
                $room->update(['status' => 'cancelled']);
                RaceCancelled::dispatch($room);
            }
        }

        return redirect()->route('dashboard');
    }

    private function resolvePlayer(Request $request, RaceRoom $room): ?RacePlayer
    {
        $token = $request->session()->get("race_player_token.{$room->id}");

        return $token ? $room->players()->where('session_token', $token)->first() : null;
    }

    private function createPlayer(RaceRoom $room, Request $request, string $nickname, bool $isHost): void
    {
        $token = Str::random(64);

        $room->players()->create([
            'user_id' => $request->user()?->id,
            'nickname' => $nickname,
            'session_token' => $token,
            'is_host' => $isHost,
            'joined_at' => now(),
            'last_seen_at' => now(),
        ]);

        $request->session()->put("race_player_token.{$room->id}", $token);

        RacePlayerJoined::dispatch($room);
    }

    private function roomSnapshot(RaceRoom $room, RacePlayer $player): array
    {
        $question = in_array($room->status, ['question', 'question_results'], true)
            ? $room->currentQuestion()
            : null;

        $existingAnswer = $question ? $player->answers()->where('question_id', $question->id)->first() : null;

        return [
            'status' => $room->status,
            'isHost' => $player->is_host,
            'questionIndex' => $room->current_question_index,
            'totalQuestions' => count($room->question_order ?? []),
            'goAt' => $room->started_at?->toIso8601String(),
            'deadlineAt' => $room->current_question_deadline_at?->toIso8601String(),
            'revealUntil' => $room->results_reveal_until?->toIso8601String(),
            'question' => $room->status === 'question' && $question ? [
                'id' => $question->id,
                'text' => $question->text,
                'answers' => $question->answers->map(fn ($a) => ['id' => $a->id, 'text' => $a->text])->values(),
            ] : null,
            'hasAnswered' => (bool) $existingAnswer,
            'selectedAnswerId' => $existingAnswer?->answer_id,
            'correctAnswerId' => $room->status === 'question_results' && $question
                ? $question->correctAnswer()?->id
                : null,
            'leaderboard' => in_array($room->status, ['question_results', 'finished'], true)
                ? $room->leaderboard()
                : null,
        ];
    }
}
