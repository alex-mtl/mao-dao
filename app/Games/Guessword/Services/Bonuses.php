<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use App\Games\Guessword\Models\GuesswordRoom;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Viewers' bonuses "on account" in a room (docs/games/guessword.md, "Players' bonuses"): free hints, cakes,
 * boosts... This table is the source of truth; the engine keeps a copy for the chat, reports what it does
 * (gifts, spending) through applyOps() and gets the host's changes pushed by change().
 */
class Bonuses
{
    public function __construct(private EngineClient $engine) {}

    /** the kinds a bonus can be: the engine's gift actions a viewer can launch from their account */
    public static function kinds(): array
    {
        return config('guessword.bonus_kinds');
    }

    public static function viewerId(string $viewer): string
    {
        return mb_strtolower(ltrim(trim($viewer), '@'));
    }

    /** [viewer => [kind => n]] of everyone with something on account */
    public function balances(GuesswordRoom $room): array
    {
        $out = [];
        foreach (DB::table('guessword_bonuses')->where('room_id', $room->id)->where('amount', '>', 0)->get() as $r) {
            $out[$r->viewer][$r->kind] = (int) $r->amount;
        }

        return $out;
    }

    /** the room page's table: one row per viewer, the latest change first */
    public function players(GuesswordRoom $room): array
    {
        $rows = DB::table('guessword_bonuses')->where('room_id', $room->id)
            ->orderByDesc('updated_at')->get()->groupBy('viewer');
        $out = [];
        foreach ($rows as $viewer => $kinds) {
            $bonuses = $kinds->filter(fn ($r) => $r->amount > 0)->mapWithKeys(fn ($r) => [$r->kind => (int) $r->amount]);
            $out[] = [
                'viewer' => $viewer,
                'name' => $kinds->pluck('name')->filter()->first() ?? $viewer,
                'bonuses' => (object) $bonuses->all(),
                'total' => $bonuses->sum(),
                'updated' => $kinds->max('updated_at'),
            ];
        }

        return $out;
    }

    /** the latest changes of one viewer (or the whole room) */
    public function log(GuesswordRoom $room, ?string $viewer = null, int $limit = 30): array
    {
        return DB::table('guessword_bonus_log as l')->leftJoin('users as u', 'u.id', '=', 'l.user_id')
            ->where('l.room_id', $room->id)
            ->when($viewer !== null, fn ($q) => $q->where('l.viewer', self::viewerId($viewer)))
            ->orderByDesc('l.id')->limit($limit)
            ->get(['l.viewer', 'l.kind', 'l.delta', 'l.balance', 'l.source', 'l.created_at', 'u.name as by'])
            ->map(fn ($r) => (array) $r)->all();
    }

    /**
     * +/- on a viewer's account (never below 0). Returns the new balance; null when the op was applied before.
     * Nothing is sent to the engine here (see change()).
     */
    public function apply(GuesswordRoom $room, string $viewer, string $kind, int $delta, string $source,
        ?int $userId = null, ?string $name = null, ?string $op = null): ?int
    {
        $viewer = self::viewerId($viewer);
        if ($viewer === '' || ! in_array($kind, self::kinds(), true) || $delta === 0) {
            return $this->amount($room, $viewer, $kind);
        }

        return DB::transaction(function () use ($room, $viewer, $kind, $delta, $source, $userId, $name, $op) {
            if ($op !== null && DB::table('guessword_bonus_log')->where('op', $op)->exists()) {
                return null;
            }
            $now = now();
            DB::table('guessword_bonuses')->insertOrIgnore([
                'room_id' => $room->id, 'viewer' => $viewer, 'kind' => $kind, 'amount' => 0,
                'name' => $name ?: null, 'created_at' => $now, 'updated_at' => $now,
            ]);
            $row = DB::table('guessword_bonuses')->where(['room_id' => $room->id, 'viewer' => $viewer, 'kind' => $kind])
                ->lockForUpdate()->first();
            $balance = max(0, (int) $row->amount + $delta);
            DB::table('guessword_bonuses')->where('id', $row->id)->update(array_filter([
                'amount' => $balance, 'updated_at' => $now, 'name' => $name ?: null,
            ], fn ($v) => $v !== null));
            DB::table('guessword_bonus_log')->insert([
                'room_id' => $room->id, 'viewer' => $viewer, 'kind' => $kind, 'delta' => $balance - (int) $row->amount,
                'balance' => $balance, 'source' => mb_substr($source, 0, 20), 'user_id' => $userId,
                'op' => $op, 'created_at' => $now,
            ]);

            return $balance;
        });
    }

    /** the host's (or the console's) change: applied here, then the engine gets the viewer's balances */
    public function change(GuesswordRoom $room, string $viewer, string $kind, int $delta, string $source,
        ?int $userId = null, ?string $name = null): int
    {
        $balance = (int) $this->apply($room, $viewer, $kind, $delta, $source, $userId, $name);
        $this->push($room, self::viewerId($viewer));

        return $balance;
    }

    /** the engine's operations [{op, viewer, kind, delta, source, name}] -> balances of the viewers touched */
    public function applyOps(GuesswordRoom $room, array $ops): array
    {
        $touched = [];
        foreach ($ops as $o) {
            if (! is_array($o) || ! is_string($o['op'] ?? null) || ! is_string($o['viewer'] ?? null)
                || ! is_string($o['kind'] ?? null) || ! is_numeric($o['delta'] ?? null)) {
                continue;
            }
            $this->apply($room, $o['viewer'], $o['kind'], (int) $o['delta'], (string) ($o['source'] ?? 'engine'),
                null, is_string($o['name'] ?? null) ? mb_substr($o['name'], 0, 100) : null, mb_substr($o['op'], 0, 80));
            $touched[self::viewerId($o['viewer'])] = true;
        }

        return collect(array_keys($touched))->mapWithKeys(fn ($v) => [$v => (object) $this->of($room, $v)])->all();
    }

    /** [kind => n] of one viewer */
    public function of(GuesswordRoom $room, string $viewer): array
    {
        return DB::table('guessword_bonuses')->where(['room_id' => $room->id, 'viewer' => self::viewerId($viewer)])
            ->where('amount', '>', 0)->pluck('amount', 'kind')->map(fn ($n) => (int) $n)->all();
    }

    private function amount(GuesswordRoom $room, string $viewer, string $kind): int
    {
        return (int) DB::table('guessword_bonuses')->where(['room_id' => $room->id, 'viewer' => $viewer, 'kind' => $kind])->value('amount');
    }

    /** the engine's copy follows; when it is down it pulls everything on the room's next start */
    private function push(GuesswordRoom $room, string $viewer): void
    {
        try {
            $this->engine->setBonuses($room, $viewer, $this->of($room, $viewer));
        } catch (Throwable $e) {
            report($e);
        }
    }
}
