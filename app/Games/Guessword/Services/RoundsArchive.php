<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Models\GuesswordRound;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;

/**
 * Every round of every LIVE of a room in one table (guessword_rounds), for the archive's round tables and the
 * clips pipeline (docs/games/guessword.md, "Rounds table").
 *
 * - Game facts (word, time, length, winner, guesses, players) are taken from the LIVE logs the archive already
 *   reads (LiveArchive): sync() refreshes a LIVE whenever its log has grown.
 * - Older LIVEs (before the logs) and what the clips pipeline finds in a recording - where the round is in it,
 *   the clip made of it, interesting moments - come through import() (`php artisan guessword:rounds-import`).
 *   A sync never overwrites those columns.
 */
class RoundsArchive
{
    /** columns a sync from the logs owns; the rest belong to import() */
    private const GAME = ['source', 'live_date', 'live_started_at', 'word', 'lang', 'tier', 'round_type', 'started_at', 'offset_s',
        'duration_s', 'reason', 'winner_uid', 'winner_id', 'winner_name', 'guesses', 'players', 'streak'];

    /** what an import may set */
    public const IMPORTABLE = ['source', 'live_date', 'live_started_at', 'word', 'lang', 'tier', 'round_type', 'started_at', 'offset_s',
        'duration_s', 'reason', 'winner_uid', 'winner_id', 'winner_name', 'guesses', 'players', 'streak', 'setter_name',
        'recording', 'recording_s', 'clip_url', 'clip_title', 'moments'];

    public function __construct(private LiveArchive $archive) {}

    /** refresh the rounds of every LIVE whose log changed since the last time (cheap: the parsed logs are cached) */
    public function sync(GuesswordRoom $room): int
    {
        $n = 0;
        foreach ($this->archive->sources($room) as $live) {
            $key = "guessword:rounds:v1:{$room->id}:{$live['file']}:{$live['size']}";
            if (Cache::has($key)) {
                continue;
            }
            $events = $this->archive->events($room, $live['file']) ?? [];
            $n += $this->store($room, $live['file'], $live['journal'] ? 'journal' : 'live', $this->fromEvents($events));
            Cache::put($key, 1, now()->addDays(60));
        }

        return $n;
    }

    /**
     * Rounds of one LIVE log's events (LiveArchive::parse): a round runs from its round_start to its round_end
     * (or its win, or the next round's start when the log has neither, as journal-rebuilt LIVEs).
     */
    public function fromEvents(array $events): array
    {
        $start = collect($events)->firstWhere('type', 'live_start');
        if (! $start) {
            return [];
        }
        $epoch = (float) ($start['epoch'] ?? 0);
        $date = substr((string) ($start['t'] ?? ''), 0, 10) ?: date('Y-m-d', (int) $epoch);
        $at = fn (float $s) => $epoch ? CarbonImmutable::createFromTimestamp($epoch + $s) : null;
        $user = fn ($u) => is_array($u) ? ['winner_uid' => ($u['uid'] ?? '') ?: null, 'winner_id' => ($u['id'] ?? '') ?: null, 'winner_name' => $u['name'] ?? null] : [];

        $rounds = [];
        $order = [];
        foreach ($events as $e) {
            $n = $e['round'] ?? null;
            $s = (float) ($e['s'] ?? 0);
            switch ($e['type']) {
                case 'round_start':
                    $rounds[$n] = [
                        'round' => (int) $n, 'word' => $e['word'] ?? null, 'lang' => $e['lang'] ?? null, 'tier' => $e['tier'] ?? null,
                        'round_type' => $e['round_type'] ?? null, 'offset_s' => $s, 'started_at' => $at($s),
                    ];
                    $order[] = $n;
                    break;
                case 'winner':
                    if (! isset($rounds[$n])) {
                        break;
                    }
                    $rounds[$n] += ['end' => $s];
                    $rounds[$n] = array_merge($rounds[$n], $user($e['user'] ?? null), array_filter([
                        'reason' => 'exact', 'word' => $e['word'] ?? $rounds[$n]['word'],
                        'guesses' => $e['guesses'] ?? null, 'streak' => $e['streak'] ?? null,
                    ], fn ($v) => $v !== null));
                    break;
                case 'round_end':
                    if (! isset($rounds[$n])) {
                        break;
                    }
                    $rounds[$n]['end'] ??= $s;          // a win ends the round a moment before its round_end
                    $rounds[$n] = array_merge($rounds[$n], array_filter([
                        'reason' => $e['reason'] ?? null, 'word' => $e['word'] ?? null,
                        'guesses' => $e['guesses'] ?? null, 'players' => $e['players'] ?? null,
                    ], fn ($v) => $v !== null));
                    if (empty($rounds[$n]['winner_name']) && isset($e['winner'])) {
                        $rounds[$n] = array_merge($rounds[$n], $user($e['winner']));
                    }
                    break;
            }
        }

        $out = [];
        foreach ($order as $i => $n) {
            $r = $rounds[$n];
            $end = $r['end'] ?? (isset($order[$i + 1]) ? $rounds[$order[$i + 1]]['offset_s'] : null);
            unset($r['end']);
            $out[] = $r + [
                'live_date' => $date,
                'live_started_at' => $at(0),
                'duration_s' => $end !== null ? (int) round(max(0, $end - $r['offset_s'])) : null,
            ];
        }

        return $out;
    }

    /** upsert rounds of one LIVE from its log: only the game's columns */
    private function store(GuesswordRoom $room, string $liveKey, string $source, array $rounds): int
    {
        foreach ($rounds as $r) {
            $row = GuesswordRound::firstOrNew(['room_id' => $room->id, 'live_key' => $liveKey, 'round' => $r['round']]);
            $row->fill(array_intersect_key($r + ['source' => $source], array_flip(self::GAME)));
            $row->save();
        }

        return count($rounds);
    }

    /**
     * Rows from outside the logs (`guessword:rounds-import`): [{live_key, round, ...IMPORTABLE}]. A new row needs
     * live_date; an existing one gets only the keys given (null clears a value).
     */
    public function import(GuesswordRoom $room, array $rows): array
    {
        $created = $updated = 0;
        $errors = [];
        foreach ($rows as $i => $r) {
            if (! is_array($r) || empty($r['live_key']) || ! isset($r['round'])) {
                $errors[] = "#{$i}: live_key and round are required";

                continue;
            }
            $row = GuesswordRound::firstOrNew(['room_id' => $room->id, 'live_key' => (string) $r['live_key'], 'round' => (int) $r['round']]);
            if (! $row->exists && empty($r['live_date'])) {
                $errors[] = "#{$i}: a new round needs live_date";

                continue;
            }
            $row->fill(array_intersect_key($r, array_flip(self::IMPORTABLE)));
            $row->source ??= 'video';
            $row->exists ? $updated++ : $created++;
            $row->save();
        }

        return compact('created', 'updated', 'errors');
    }

    /** the strip of every LIVE in the archive list: [live_key => [[duration_s, reason, has clip], ...]] */
    public function strips(GuesswordRoom $room): array
    {
        return GuesswordRound::where('room_id', $room->id)->orderBy('live_key')->orderBy('round')
            ->get(['live_key', 'duration_s', 'reason', 'clip_url', 'moments'])
            ->groupBy('live_key')
            ->map(fn ($rs) => $rs->map(fn ($r) => [(int) $r->duration_s, $r->reason ?? '', $r->clip_url ? 1 : ($r->moments ? 2 : 0)])->values())
            ->all();
    }

    /** LIVEs known only from imported rounds (no log): the archive lists them after the logged ones */
    public function recordedOnly(GuesswordRoom $room, array $loggedFiles): array
    {
        return GuesswordRound::where('room_id', $room->id)->whereNotIn('live_key', $loggedFiles ?: [''])
            ->get()->groupBy('live_key')
            ->map(function ($rs, $key) {
                $first = $rs->sortBy('offset_s')->first();
                $last = $rs->sortByDesc('offset_s')->first();
                $champ = $rs->whereNotNull('winner_name')->countBy('winner_name')->sortDesc();

                return [
                    'file' => $key,
                    'recorded' => true,
                    'date' => $first->live_date?->format('Y-m-d'),
                    'started' => $first->live_started_at?->toIso8601String(),
                    'duration' => (int) round(($last->offset_s ?? 0) + ($last->duration_s ?? 0)),
                    'rounds' => $rs->count(),
                    'wins' => $rs->whereNotNull('winner_name')->count(),
                    'champion' => $champ->isNotEmpty() ? ['name' => $champ->keys()->first(), 'wins' => $champ->first()] : null,
                    'recording' => $first->recording,
                ];
            })->sortByDesc('date')->values()->all();
    }

    /** every round of one LIVE for the table */
    public function rounds(GuesswordRoom $room, string $liveKey): array
    {
        return GuesswordRound::where('room_id', $room->id)->where('live_key', $liveKey)->orderBy('offset_s')->orderBy('round')->get()
            ->map(fn (GuesswordRound $r) => [
                'round' => $r->round, 'word' => $r->word, 'lang' => $r->lang, 'tier' => $r->tier, 'type' => $r->round_type,
                'started' => $r->started_at?->toIso8601String(), 'offset' => $r->offset_s, 'duration' => $r->duration_s,
                'reason' => $r->reason, 'winner' => $r->winner_name, 'winnerId' => $r->winner_id,
                'guesses' => $r->guesses, 'players' => $r->players, 'streak' => $r->streak, 'setter' => $r->setter_name,
                'recording' => $r->recording, 'recordingAt' => $r->recording_s,
                'clip' => $r->clip_url, 'clipTitle' => $r->clip_title, 'moments' => $r->moments ?? [],
            ])->all();
    }
}
