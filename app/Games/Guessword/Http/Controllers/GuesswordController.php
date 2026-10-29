<?php

declare(strict_types=1);

namespace App\Games\Guessword\Http\Controllers;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Services\BotClient;
use App\Games\Guessword\Services\EngineClient;
use App\Http\Controllers\Controller;
use App\Services\Capabilities;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

/**
 * Guess the Word for TikTok LIVE: the section page (games running now) and the streamer's own
 * room (settings, start / stop, the TikTok LIVE Studio link, the engine's menu embedded).
 */
class GuesswordController extends Controller
{
    public function __construct(
        private EngineClient $engine,
        private BotClient $bot,
        private Capabilities $capabilities,
    ) {}

    public function index(Request $request): Response
    {
        $statuses = $this->engine->statuses();
        $running = collect();
        if ($statuses !== null) {
            $running = GuesswordRoom::with('user:id,name')->get()
                ->filter(fn (GuesswordRoom $r) => ($statuses[$r->engineId()]['running'] ?? false))
                ->map(fn (GuesswordRoom $r) => [
                    'streamer' => $r->user->name,
                    'tiktok' => $r->tiktok_username,
                    'tiktokUrl' => $r->tiktok_username ? 'https://www.tiktok.com/@'.$r->tiktok_username.'/live' : null,
                    'since' => $r->last_started_at?->toIso8601String(),
                ])->values();
        }

        return Inertia::render('Guessword/Index', [
            'games' => $running,
            'engineOnline' => $statuses !== null,
            'canStart' => $this->capabilities->allows($request->user(), Capabilities::GUESSWORD_TIKTOK),
            'isAdmin' => (bool) $request->user()?->isSuperAdmin(),
        ]);
    }

    public function room(Request $request, ?GuesswordRoom $room = null): Response
    {
        $room = $this->roomFor($request, $room);
        $statuses = $this->engine->statuses();
        $status = $statuses[$room->engineId()] ?? null;

        return Inertia::render('Guessword/Room', [
            'room' => [
                'id' => $room->id,
                // a super admin in someone else's room: whose it is (the page then acts on this room)
                'foreign' => $room->user_id !== $request->user()->id ? $room->user()->value('name') : null,
                'tiktok' => $room->tiktok_username,
                'lang' => $room->lang,
                'hasEulerKey' => filled($room->euler_key),
                'overlayUrl' => $room->overlayUrl(),
                'controlUrl' => $room->controlUrl(),
                'running' => (bool) ($status['running'] ?? false),
                'tiktokStatus' => $status['tiktok'] ?? null,
                'stopReason' => $status['stop_reason'] ?? null,     // "no_live": stopped itself, no TikTok LIVE
                'engineOnline' => $statuses !== null,
            ],
            'languages' => config('guessword.languages'),
            'notice' => session('success'),
            'problem' => session('error'),
        ]);
    }

    public function update(Request $request, ?GuesswordRoom $room = null): RedirectResponse
    {
        $room = $this->roomFor($request, $room);
        $data = $request->validate([
            'tiktok' => ['nullable', 'string', 'max:64', 'regex:/^@?[A-Za-z0-9_.]{2,30}$/'],
            'lang' => ['required', Rule::in(config('guessword.languages'))],
            'euler_key' => ['nullable', 'string', 'max:200'],
            'clear_euler_key' => ['boolean'],
        ]);
        $tiktok = filled($data['tiktok'] ?? null) ? strtolower(ltrim($data['tiktok'], '@')) : null;
        if ($tiktok && GuesswordRoom::where('tiktok_username', $tiktok)->whereKeyNot($room->id)->exists()) {
            return back()->withErrors(['tiktok' => __('guessword.tiktok_taken')]);
        }

        $room->tiktok_username = $tiktok;
        $room->lang = $data['lang'];
        if (filled($data['euler_key'] ?? null)) {
            $room->euler_key = trim($data['euler_key']);
        } elseif ($request->boolean('clear_euler_key')) {
            $room->euler_key = null;
        }
        $room->save();

        return $this->toEngine(fn () => $this->engine->sync($room), 'guessword.saved');
    }

    public function start(Request $request, ?GuesswordRoom $room = null): RedirectResponse
    {
        $room = $this->roomFor($request, $room);
        if (! $room->tiktok_username) {
            return back()->withErrors(['tiktok' => __('guessword.tiktok_required')]);
        }

        return $this->toEngine(function () use ($room) {
            $this->bot->ensureKey($room);              // first start: the room becomes a game in the bot
            $this->engine->start($room);
            $room->forceFill(['last_started_at' => now()])->save();
        }, 'guessword.started');
    }

    public function stop(Request $request, ?GuesswordRoom $room = null): RedirectResponse
    {
        $room = $this->roomFor($request, $room);

        return $this->toEngine(fn () => $this->engine->stop($room), 'guessword.stopped');
    }

    /** a new Studio link (the old one stops working) */
    public function regenerateLink(Request $request, ?GuesswordRoom $room = null): RedirectResponse
    {
        $room = $this->roomFor($request, $room);
        $room->regenerateOverlayToken();

        return $this->toEngine(fn () => $this->engine->sync($room), 'guessword.link_regenerated');
    }

    /** super admins: every streamer's room, with the way into each */
    public function rooms(Request $request): Response
    {
        abort_unless($request->user()->isSuperAdmin(), 403);
        $statuses = $this->engine->statuses();

        return Inertia::render('Guessword/Rooms', [
            'rooms' => GuesswordRoom::with('user:id,name,email')->orderByDesc('last_started_at')->get()
                ->map(fn (GuesswordRoom $r) => [
                    'id' => $r->id,
                    'streamer' => $r->user->name,
                    'email' => $r->user->email,
                    'tiktok' => $r->tiktok_username,
                    'running' => (bool) ($statuses[$r->engineId()]['running'] ?? false),
                    'lastStarted' => $r->last_started_at?->toIso8601String(),
                ])->values(),
            'engineOnline' => $statuses !== null,
        ]);
    }

    /**
     * The room an action is for: no room given = the signed-in streamer's own room, created on first
     * visit (403 without access to the TikTok mode); a room given (/guessword/rooms/{room}) = super admins only.
     */
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

    private function toEngine(callable $call, string $okMessage): RedirectResponse
    {
        try {
            $call();
        } catch (Throwable $e) {
            report($e);

            return back()->with('error', __('guessword.engine_unavailable'));
        }

        return back()->with('success', __($okMessage));
    }
}
