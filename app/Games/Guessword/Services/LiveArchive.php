<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use App\Games\Guessword\Models\GuesswordRoom;
use Illuminate\Support\Facades\Cache;

/**
 * The streamer's archive of LIVEs, from the engine's LIVE logs (docs/games/guessword.md, "Live logs").
 * Laravel only counts and filters facts; what is made of them (temperature, races, the digest video)
 * is the browser's job (resources/js/Pages/Guessword/Digest/model.js), so the archive page and the
 * local clips pipeline share one logic. A parsed log is cached by its size: a finished LIVE never changes.
 */
class LiveArchive
{
    /** event types the digest uses; the rest of a log (viewers, gifts) stays on the server */
    public const DIGEST_TYPES = ['live_start', 'round_start', 'winner', 'plane', 'balloon', 'cake'];

    /** BIN of model.js: activity is counted per 5 stream minutes */
    public const BIN = 300;

    public function __construct(private EngineClient $engine) {}

    /** every LIVE of the room, newest first: file, date, duration and the counts of the list */
    public function lives(GuesswordRoom $room): array
    {
        return collect($this->engine->lives($room))
            ->sortByDesc('file')
            ->map(fn (array $l) => ['file' => $l['file']] + $this->parsed($room, $l['file'], (int) $l['size'])['summary'])
            ->values()->all();
    }

    /** the digest's events of one LIVE (JSONL objects of DIGEST_TYPES, users cut to uid / id / name) */
    public function events(GuesswordRoom $room, string $file): ?array
    {
        $live = collect($this->engine->lives($room))->firstWhere('file', $file);

        return $live ? $this->parsed($room, $file, (int) $live['size'])['events'] : null;
    }

    private function parsed(GuesswordRoom $room, string $file, int $size): array
    {
        return Cache::remember("guessword:live:{$room->engineId()}:{$file}:{$size}", now()->addDays(30),
            fn () => $this->parse($this->engine->live($room, $file)));
    }

    public function parse(string $jsonl): array
    {
        $events = [];
        $duration = 0.0;
        foreach (preg_split('/\r?\n/', $jsonl) as $line) {
            $e = $line === '' ? null : json_decode($line, true);
            if (! is_array($e)) {
                continue;
            }
            $duration = max($duration, (float) ($e['s'] ?? 0));
            if (! in_array($e['type'] ?? null, self::DIGEST_TYPES, true)) {
                continue;
            }
            if (isset($e['user'])) {
                $e['user'] = array_intersect_key((array) $e['user'], array_flip(['uid', 'id', 'name']));
            }
            unset($e['podium'], $e['setter']);
            $events[] = $e;
        }

        return ['events' => $events, 'summary' => $this->summary($events, $duration)];
    }

    private function summary(array $events, float $duration): array
    {
        $of = fn (string $type) => array_values(array_filter($events, fn ($e) => $e['type'] === $type && isset($e['s'])));
        $start = $of('live_start')[0] ?? null;
        // balloons: a like balloon is one, a gift / manual launch of N is N (factsFromLive in model.js)
        $balloons = fn (array $e) => isset($e['likes']) ? 1 : (int) ($e['count'] ?? 1);

        $bins = array_fill(0, max(1, (int) ceil($duration / self::BIN)), ['w' => 0, 'b' => 0, 'p' => 0, 'c' => 0]);
        $at = fn (array $e) => min(count($bins) - 1, max(0, (int) floor($e['s'] / self::BIN)));
        foreach (['winner' => 'w', 'plane' => 'p', 'cake' => 'c'] as $type => $k) {
            foreach ($of($type) as $e) {
                $bins[$at($e)][$k]++;
            }
        }
        foreach ($of('balloon') as $e) {
            $bins[$at($e)]['b'] += $balloons($e);
        }

        // the champion: most wins, one player = one TikTok user id; the name of their latest win
        $wins = [];
        foreach ($of('winner') as $e) {
            $u = $e['user'] ?? [];
            $key = ($u['uid'] ?? '') ?: ($u['id'] ?? '') ?: ($u['name'] ?? '?');
            $wins[$key] = ['n' => ($wins[$key]['n'] ?? 0) + 1, 'name' => $u['name'] ?? $u['id'] ?? '?', 'avatar' => ($u['uid'] ?? '') ?: ($u['id'] ?? '')];
        }
        uasort($wins, fn ($a, $b) => $b['n'] <=> $a['n']);
        $champion = $wins ? reset($wins) : null;

        return [
            'started' => $start['t'] ?? null,
            'date' => $start ? substr((string) $start['t'], 0, 10) : null,
            'duration' => (int) round($duration),
            'rounds' => count($of('round_start')),
            'wins' => count($of('winner')),
            'planes' => count($of('plane')),
            'balloons' => array_sum(array_map($balloons, $of('balloon'))),
            'cakes' => count($of('cake')),
            'champion' => $champion ? ['name' => $champion['name'], 'avatar' => $champion['avatar'], 'wins' => $champion['n']] : null,
            'bins' => $bins,
        ];
    }
}
