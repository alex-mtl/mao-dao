<?php

declare(strict_types=1);

namespace App\Games\Guessword\Console;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Services\EngineClient;
use App\Games\Guessword\Services\LiveArchive;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Console\Command;
use Throwable;

/**
 * One day of Guess the Word streams, per streamer: LIVEs, rounds, new followers,
 * gifts and their approximate value. The engine's LIVE logs are the only source
 * (same pairing as LiveArchive::sources: the engine's logs, plus journal-rebuilt
 * ones for LIVEs the engine has no log of). A LIVE belongs to the day it
 * started, in --tz; a LIVE crossing midnight stays with its start day.
 *
 *   php artisan guessword:daily-stats [2026-10-30] [--tz=America/Toronto] [--room=gw1] [--json]
 *
 * Limits, stated in the output too: the LIVE log keeps only gifts of 100+ coins
 * a batch or bound to an action other than a hint (stream-engine/app/live_log.py),
 * so gift counts and coin sums are lower bounds. The engine does not write
 * follow events to the log yet, so the followers column counts `follow` events
 * and stays 0 until the engine logs them.
 */
class DailyStatsCommand extends Command
{
    protected $signature = 'guessword:daily-stats {date? : day in --tz, default yesterday}
        {--tz=America/Toronto : timezone of the day boundary}
        {--room= : only this room: gwN or @tiktok_username}
        {--json : output JSON instead of a table}';

    protected $description = 'Per-streamer stats of one day of Guess the Word LIVEs: streams, rounds, followers, gifts';

    /** a TikTok coin is worth about $0.005 to the host (Universe: 44,999 coins ≈ $225) */
    private const USD_PER_COIN = 0.005;

    public function handle(EngineClient $engine): int
    {
        try {
            $tz = new DateTimeZone((string) ($this->option('tz') ?: 'America/Toronto'));
        } catch (Throwable) {
            $this->error('bad --tz: '.$this->option('tz'));

            return self::FAILURE;
        }
        $date = (string) ($this->argument('date') ?: (new DateTimeImmutable('now', $tz))->modify('-1 day')->format('Y-m-d'));
        if (! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            $this->error('bad date, use YYYY-MM-DD: '.$date);

            return self::FAILURE;
        }

        $rooms = GuesswordRoom::with('user')->orderBy('id')->get()->filter(function (GuesswordRoom $room) {
            $want = (string) ($this->option('room') ?: '');

            return $want === '' || $room->engineId() === $want
                || ($room->tiktok_username && ('@'.$room->tiktok_username === $want || $room->tiktok_username === $want));
        });
        if ($rooms->isEmpty()) {
            $this->error('no such room: '.$this->option('room'));

            return self::FAILURE;
        }

        $rows = [];
        foreach ($rooms as $room) {
            $lives = $this->livesOf($room, $engine);
            foreach ($lives as $live) {
                $st = $this->parseLive($live['content'], $tz, $date);
                if ($st === null) {
                    continue;
                }
                $key = $room->engineId();
                $rows[$key] ??= [
                    'room' => $room->engineId(),
                    'streamer' => '@'.($room->tiktok_username ?: $room->engineId()),
                    'name' => $room->user->name ?? '',
                    'lives' => 0, 'rounds' => 0, 'wins' => 0, 'seconds' => 0.0,
                    'follows' => 0, 'gifts' => 0, 'coins' => 0, 'files' => [],
                ];
                $rows[$key]['lives']++;
                $rows[$key]['rounds'] += $st['rounds'];
                $rows[$key]['wins'] += $st['wins'];
                $rows[$key]['seconds'] = max($rows[$key]['seconds'], 0) + $st['seconds'];
                $rows[$key]['follows'] += $st['follows'];
                $rows[$key]['gifts'] += $st['gifts'];
                $rows[$key]['coins'] += $st['coins'];
                $rows[$key]['files'][] = $live['file'];
            }
        }
        $rows = array_values($rows);

        if ($this->option('json')) {
            $this->line(json_encode([
                'date' => $date, 'tz' => $tz->getName(),
                'caveats' => [
                    'gifts' => 'LIVE log only: hint-only gifts under 100 coins a batch are not logged, sums are lower bounds.',
                    'follows' => 'Counts follow events in the LIVE log; the engine does not write them yet, so 0 until it does.',
                    'day' => 'A LIVE belongs to the day it started.',
                ],
                'streamers' => array_map(fn (array $r) => $r + ['usd' => round($r['coins'] * self::USD_PER_COIN, 2)], $rows),
                'total' => $this->total($rows),
            ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

            return self::SUCCESS;
        }

        if ($rows === []) {
            $this->info("{$date}: no Guess the Word LIVEs.");

            return self::SUCCESS;
        }

        $total = $this->total($rows);
        $table = array_map(fn (array $r) => [
            $r['streamer'].($r['name'] !== '' ? " ({$r['name']})" : ''),
            $r['lives'], $r['rounds'], $this->hours($r['seconds']),
            $r['follows'], $r['gifts'], $r['coins'],
            '$'.number_format($r['coins'] * self::USD_PER_COIN, 2),
        ], $rows);
        $table[] = ['ИТОГО', $total['lives'], $total['rounds'], $this->hours($total['seconds']),
            $total['follows'], $total['gifts'], $total['coins'],
            '$'.number_format($total['coins'] * self::USD_PER_COIN, 2)];
        $this->table(
            ['Стример', 'Эфиры', 'Раунды', 'Часы', 'Подписчики', 'Подарки', 'Монеты', '≈ $'],
            $table,
        );
        $this->line("День {$date} ({$tz->getName()}); эфир отнесён ко дню старта.");
        $this->line('Подарки и монеты — из лога эфира: подарки-подсказки дешевле 100 монет в лог не пишутся, это нижняя оценка.');
        $this->line('Подписчики: движок пока не пишет follow-события в лог, поэтому 0. Нужна одна строка в движке.');
        $this->line('≈ $: монеты × 0.005 (Universe: 44 999 монет ≈ $225 хосту).');

        return self::SUCCESS;
    }

    /** the room's LIVE logs of any day: engine logs first, journal ones only for LIVEs it lacks */
    private function livesOf(GuesswordRoom $room, EngineClient $engine): array
    {
        $tt = fn (string $file) => preg_replace('/^.*_(\d+)\.jsonl$/', '$1', $file);
        try {
            $listed = $engine->lives($room);
        } catch (Throwable $e) {
            $this->warn("{$room->engineId()}: engine lives unavailable ({$e->getMessage()}), journal only.");
            $listed = [];
        }
        $out = [];
        foreach ($listed as $l) {
            try {
                $out[$tt($l['file'])] = ['file' => $l['file'], 'content' => $engine->live($room, $l['file'])];
            } catch (Throwable $e) {
                $this->warn("{$room->engineId()}: cannot read {$l['file']} ({$e->getMessage()}).");
            }
        }
        foreach (glob(LiveArchive::journalDir($room->engineId()).'/*.jsonl') ?: [] as $path) {
            $file = basename($path);
            if (! isset($out[$tt($file)])) {
                $out[$tt($file)] = ['file' => $file, 'content' => (string) file_get_contents($path)];
            }
        }

        return array_values($out);
    }

    /** counts of one LIVE log, or null when the LIVE started on another day */
    private function parseLive(string $jsonl, DateTimeZone $tz, string $date): ?array
    {
        $st = ['rounds' => 0, 'wins' => 0, 'seconds' => 0.0, 'follows' => 0, 'gifts' => 0, 'coins' => 0];
        $started = false;
        foreach (preg_split('/\r?\n/', $jsonl) as $line) {
            $e = $line === '' ? null : json_decode($line, true);
            if (! is_array($e)) {
                continue;
            }
            if (($e['type'] ?? null) === 'live_start') {
                if ($started) {
                    continue;
                }
                $started = true;
                try {
                    $day = (new DateTimeImmutable((string) ($e['t'] ?? '')))->setTimezone($tz)->format('Y-m-d');
                } catch (Throwable) {
                    return null;
                }
                if ($day !== $date) {
                    return null;
                }
            }
            if (! $started) {
                continue;
            }
            $st['seconds'] = max($st['seconds'], (float) ($e['s'] ?? 0));
            match ($e['type'] ?? null) {
                'round_start' => $st['rounds']++,
                'winner' => $st['wins']++,
                'follow' => $st['follows']++,
                'gift' => $this->countGift($st, $e),
                default => null,
            };
        }

        return $started ? $st : null;
    }

    /** a gift to the host only (empty `to`): a gift to a guest on the same LIVE is not the host's */
    private function countGift(array &$st, array $e): void
    {
        if (! empty($e['to'])) {
            return;
        }
        $st['gifts'] += (int) ($e['count'] ?? 1);
        $st['coins'] += (int) ($e['coins'] ?? 0) * (int) ($e['count'] ?? 1);
    }

    private function total(array $rows): array
    {
        $t = ['lives' => 0, 'rounds' => 0, 'wins' => 0, 'seconds' => 0.0, 'follows' => 0, 'gifts' => 0, 'coins' => 0];
        foreach ($rows as $r) {
            foreach (array_keys($t) as $k) {
                $t[$k] += $r[$k];
            }
        }
        $t['usd'] = round($t['coins'] * self::USD_PER_COIN, 2);

        return $t;
    }

    private function hours(float $seconds): string
    {
        $h = (int) floor($seconds / 3600);
        $m = (int) round(($seconds - $h * 3600) / 60);

        return $h.':'.str_pad((string) $m, 2, '0', STR_PAD_LEFT);
    }
}
