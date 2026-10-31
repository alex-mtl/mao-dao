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
    public const DIGEST_TYPES = ['live_start', 'round_start', 'round_end', 'winner', 'plane', 'balloon', 'cake', 'cake_start', 'cake_last', 'cake_split', 'fire'];

    /** BIN of model.js: activity is counted per 5 stream minutes */
    public const BIN = 300;

    /** seconds without a single event after which the LIVE is taken as ended */
    public const END_GAP = 1800;

    public function __construct(private EngineClient $engine) {}

    /** LIVE logs rebuilt from the engine journal (JournalLivesCommand): older LIVEs, nicknames only */
    public static function journalDir(string $engineId): string
    {
        return storage_path('app/guessword/journal-lives/'.$engineId);
    }

    /** every LIVE of the room, newest first: file, date, duration and the counts of the list */
    public function lives(GuesswordRoom $room): array
    {
        return collect($this->sources($room))
            ->sortByDesc('file')
            ->map(fn (array $l) => ['file' => $l['file'], 'journal' => $l['journal']] + $this->parsed($room, $l)['summary'])
            ->values()->all();
    }

    /** the digest's events of one LIVE (JSONL objects of DIGEST_TYPES, users cut to uid / id / name) */
    public function events(GuesswordRoom $room, string $file): ?array
    {
        $live = collect($this->sources($room))->firstWhere('file', $file);

        return $live ? $this->parsed($room, $live)['events'] : null;
    }

    /** the engine's logs, plus journal ones of LIVEs it has no log of (same TikTok LIVE id = same LIVE) */
    private function sources(GuesswordRoom $room): array
    {
        $tt = fn (string $file) => preg_replace('/^.*_(\d+)\.jsonl$/', '$1', $file);
        $engine = collect($this->engine->lives($room))->map(fn ($l) => ['file' => $l['file'], 'size' => (int) $l['size'], 'journal' => false]);
        $known = $engine->map(fn ($l) => $tt($l['file']))->flip();
        $journal = collect(glob(self::journalDir($room->engineId()).'/*.jsonl') ?: [])
            ->map(fn ($p) => ['file' => basename($p), 'size' => (int) filesize($p), 'journal' => true])
            ->reject(fn ($l) => isset($known[$tt($l['file'])]));

        return $engine->concat($journal)->values()->all();
    }

    private function parsed(GuesswordRoom $room, array $live): array
    {
        $source = $live['journal'] ? 'journal' : 'live';

        // v6: + podiums; v5: the LIVE ends at a 30 min silence (bump when the summary or the events change)
        return Cache::remember("guessword:v5:{$source}:{$room->engineId()}:{$live['file']}:{$live['size']}", now()->addDays(30),
            fn () => $this->parse($live['journal']
                ? (string) file_get_contents(self::journalDir($room->engineId()).'/'.$live['file'])
                : $this->engine->live($room, $live['file'])));
    }

    public function parse(string $jsonl): array
    {
        $events = $gifts = [];
        $duration = 0.0;
        foreach (preg_split('/\r?\n/', $jsonl) as $line) {
            $e = $line === '' ? null : json_decode($line, true);
            if (! is_array($e)) {
                continue;
            }
            // a LIVE always has viewers / likes coming in: a long silence means it is over, and what the
            // engine writes after it (a round ended the next morning) belongs to no LIVE
            if ((float) ($e['s'] ?? 0) - $duration > self::END_GAP) {
                break;
            }
            $duration = max($duration, (float) ($e['s'] ?? 0));
            // gifts to the host stay on the server; only who gave the most coins goes into the summary
            if (($e['type'] ?? null) === 'gift' && empty($e['to']) && isset($e['user'])) {
                $gifts[] = ['user' => $e['user'], 'n' => (int) ($e['coins'] ?? 0) * (int) ($e['count'] ?? 1)];
            }
            if (! in_array($e['type'] ?? null, self::DIGEST_TYPES, true)) {
                continue;
            }
            if (isset($e['user'])) {
                $e['user'] = array_intersect_key((array) $e['user'], array_flip(['uid', 'id', 'name']));
            }
            unset($e['podium'], $e['setter']);
            $events[] = $e;
        }

        return ['events' => $events, 'summary' => $this->summary($events, $duration, $gifts)];
    }

    /** The leader of [{user, n}] (see ranked) or null */
    private function top(array $items): ?array
    {
        return $this->ranked($items)[0] ?? null;
    }

    /** Places 1-3 of [{user, n}] (see ranked); a tie shares the place, so a podium can hold more than three */
    private function podium(array $items): array
    {
        $all = $this->ranked($items);
        $third = $all ? $all[min(2, count($all) - 1)]['n'] : 0;

        return array_values(array_filter($all, fn ($p) => $p['n'] >= $third));
    }

    /**
     * [{user, n}] summed per player, most first: one player = one TikTok user id; [{name (latest),
     * id (@unique_id, for a hashtag), avatar, n (summed)}]
     */
    private function ranked(array $items): array
    {
        $by = [];
        foreach ($items as $it) {
            $u = (array) ($it['user'] ?? []);
            $key = ($u['uid'] ?? '') ?: ($u['id'] ?? '') ?: ($u['name'] ?? '');
            if ($key === '' || $it['n'] <= 0) {
                continue;
            }
            $by[$key] = ['n' => ($by[$key]['n'] ?? 0) + $it['n'], 'name' => $u['name'] ?? $u['id'] ?? '?',
                'id' => $u['id'] ?? '', 'avatar' => ($u['uid'] ?? '') ?: ($u['id'] ?? '')];
        }
        uasort($by, fn ($a, $b) => $b['n'] <=> $a['n']);

        return array_values($by);
    }

    private function summary(array $events, float $duration, array $gifts = []): array
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

        // the leaders of the LIVE (the archive's hashtags): the game's champion (most wins) first, then most
        // planes, most gift coins, most balloons
        $one = fn (array $e) => ['user' => $e['user'] ?? [], 'n' => 1];
        $champion = $this->top(array_map($one, $of('winner')));
        $leaders = array_filter([
            'wins' => $champion,
            'planes' => $this->top(array_map($one, $of('plane'))),
            'gifts' => $this->top($gifts),
            'balloons' => $this->top(array_map(fn ($e) => ['user' => $e['user'] ?? [], 'n' => $balloons($e)], $of('balloon'))),
        ]);

        return [
            'started' => $start['t'] ?? null,
            // the LIVE Center recording of this LIVE has this id; epoch = unix time of second 0 of the log
            'tiktokRoom' => isset($start['tiktok_room']) ? (string) $start['tiktok_room'] : null,
            'epoch' => isset($start['epoch']) ? (float) $start['epoch'] : null,
            'date' => $start ? substr((string) $start['t'], 0, 10) : null,
            'duration' => (int) round($duration),
            'rounds' => count($of('round_start')),
            'wins' => count($of('winner')),
            'planes' => count($of('plane')),
            'balloons' => array_sum(array_map($balloons, $of('balloon'))),
            'cakes' => count($of('cake')),
            'champion' => $champion ? ['name' => $champion['name'], 'avatar' => $champion['avatar'], 'wins' => $champion['n']] : null,
            'leaders' => array_map(fn ($l) => ['name' => $l['name'], 'id' => $l['id'], 'n' => $l['n']], $leaders),
            // places 1-3 of the word race and of the planes: all of them are mentioned in the digest's caption
            'podiums' => array_map(fn (array $p) => array_map(fn ($l) => ['name' => $l['name'], 'id' => $l['id'], 'n' => $l['n']], $p), [
                'wins' => $this->podium(array_map($one, $of('winner'))),
                'planes' => $this->podium(array_map($one, $of('plane'))),
            ]),
            'bins' => $bins,
        ];
    }
}
