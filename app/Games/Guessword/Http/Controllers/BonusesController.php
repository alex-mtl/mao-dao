<?php

declare(strict_types=1);

namespace App\Games\Guessword\Http\Controllers;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Services\Bonuses;
use App\Http\Controllers\Controller;
use App\Services\Capabilities;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Viewers' bonuses on account (the room page's "Players' bonuses" tab, JSON) and the engine's side of the
 * same accounts (/internal/guessword/bonuses, header X-Internal-Secret = GUESSWORD_ENGINE_SECRET).
 */
class BonusesController extends Controller
{
    public function __construct(private Bonuses $bonuses, private Capabilities $capabilities) {}

    /** every viewer with bonuses (or who had them), and one viewer's latest changes (?viewer=) */
    public function index(Request $request, ?GuesswordRoom $room = null): JsonResponse
    {
        $room = $this->roomFor($request, $room);
        $viewer = $request->query('viewer');

        return response()->json([
            'kinds' => Bonuses::kinds(),
            'players' => $this->bonuses->players($room),
            'log' => $this->bonuses->log($room, is_string($viewer) && $viewer !== '' ? $viewer : null),
        ]);
    }

    /** the host puts a bonus on a viewer's account or takes it away: {viewer, kind, delta, name?} */
    public function change(Request $request, ?GuesswordRoom $room = null): JsonResponse
    {
        $room = $this->roomFor($request, $room);
        $data = $request->validate([
            'viewer' => ['required', 'string', 'max:64', 'regex:/^@?[\w.\-]+$/u'],
            'kind' => ['required', 'string', Rule::in(Bonuses::kinds())],
            'delta' => ['required', 'integer', 'between:-1000,1000', 'not_in:0'],
            'name' => ['nullable', 'string', 'max:100'],
        ]);
        $balance = $this->bonuses->change($room, $data['viewer'], $data['kind'], (int) $data['delta'], 'host',
            $request->user()->id, $data['name'] ?? null);

        return response()->json(['viewer' => Bonuses::viewerId($data['viewer']), 'kind' => $data['kind'], 'balance' => $balance]);
    }

    /** the engine: every balance of its room (?room=gw<id>), on start and now and then */
    public function engineBalances(Request $request): JsonResponse
    {
        $room = $this->engineRoom($request, $request->query('room'));

        return response()->json(['balances' => (object) array_map(fn ($b) => (object) $b, $this->bonuses->balances($room))]);
    }

    /** the engine: what happened on its side (gifts, spending) {room, ops: [...]} -> balances of those viewers */
    public function engineOps(Request $request): JsonResponse
    {
        $room = $this->engineRoom($request, $request->input('room'));
        $ops = $request->input('ops');
        abort_unless(is_array($ops) && count($ops) <= 1000, 422);

        return response()->json(['balances' => (object) $this->bonuses->applyOps($room, $ops)]);
    }

    private function engineRoom(Request $request, mixed $engineId): GuesswordRoom
    {
        $secret = (string) config('guessword.engine_secret');
        abort_unless($secret !== '' && hash_equals($secret, (string) $request->header('X-Internal-Secret')), 403);
        abort_unless(is_string($engineId) && preg_match('/^gw(\d+)$/', $engineId, $m), 422);

        return GuesswordRoom::findOrFail((int) $m[1]);
    }

    /** the same rule as the room page: your own room, or any room for super admins */
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
