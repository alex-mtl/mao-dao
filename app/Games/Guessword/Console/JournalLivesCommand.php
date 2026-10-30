<?php

declare(strict_types=1);

namespace App\Games\Guessword\Console;

use App\Games\Guessword\Services\EngineClient;
use App\Games\Guessword\Services\JournalLives;
use App\Games\Guessword\Services\LiveArchive;
use Illuminate\Console\Command;
use Throwable;

/**
 * LIVE logs for the stream archive from days of the engine's journal (R2: guessword-engine/YYYY/*.log.xz,
 * services/journal-archive/README.md), for LIVEs the engine has no log of (before 29.10.2026):
 *
 *   php artisan guessword:journal-lives /tmp/jr/2026-10-2*.log [--dry-run] [--force]
 *
 * Files: plain or .xz, given oldest first (a LIVE can cross midnight UTC). Writes
 * storage/app/guessword/journal-lives/<room>/<file>.jsonl; a LIVE the engine logged itself is skipped,
 * an existing file is kept (--force: rewritten, e.g. when the rebuild learns more from the journal).
 */
class JournalLivesCommand extends Command
{
    protected $signature = 'guessword:journal-lives {files* : journal days (journalctl -o short-iso), .log or .log.xz}
        {--dry-run : only list what would be written}
        {--force : rewrite files this command wrote before}';

    protected $description = 'Rebuild LIVE logs of the stream archive from the engine journal';

    public function handle(JournalLives $journal, EngineClient $engine): int
    {
        $lines = (function () {
            foreach ($this->argument('files') as $f) {
                $h = str_ends_with($f, '.xz') ? popen('xz -dc '.escapeshellarg($f), 'r') : fopen($f, 'r');
                if (! $h) {
                    throw new \RuntimeException("cannot read {$f}");
                }
                while (($l = fgets($h)) !== false) {
                    yield $l;
                }
                str_ends_with($f, '.xz') ? pclose($h) : fclose($h);
            }
        })();
        $lives = $journal->parse($lines);

        // TikTok LIVE ids the engine has its own log of (file names end with _<id>.jsonl)
        try {
            $logged = collect($engine->allLives())->map(fn ($l) => preg_replace('/^.*_(\d+)\.jsonl$/', '$1', $l['file']))->flip();
        } catch (Throwable $e) {
            $this->error('engine unavailable: '.$e->getMessage());

            return self::FAILURE;
        }

        $written = 0;
        foreach ($lives as $room => $files) {
            foreach ($files as $file => $events) {
                $tt = preg_replace('/^.*_(\d+)\.jsonl$/', '$1', $file);
                $path = LiveArchive::journalDir($room).'/'.$file;
                $state = isset($logged[$tt]) ? 'engine has it' : (is_file($path) ? 'exists' : 'new');
                $wins = count(array_filter($events, fn ($e) => $e['type'] === 'winner'));
                $this->line(sprintf('%s %s  %d events, %d wins, %s', $room, $file, count($events), $wins, $state));
                if ($state === 'exists' && $this->option('force')) {
                    $state = 'rewritten';
                }
                if (! in_array($state, ['new', 'rewritten'], true) || $this->option('dry-run')) {
                    continue;
                }
                @mkdir(dirname($path), 0775, true);
                file_put_contents($path, implode("\n", array_map(fn ($e) => json_encode($e, JSON_UNESCAPED_UNICODE), $events))."\n");
                $written++;
            }
        }
        $this->info("written: {$written}");

        return self::SUCCESS;
    }
}
