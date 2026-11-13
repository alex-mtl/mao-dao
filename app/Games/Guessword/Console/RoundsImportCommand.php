<?php

declare(strict_types=1);

namespace App\Games\Guessword\Console;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Services\RoundsArchive;
use Illuminate\Console\Command;

/**
 * The rounds table (guessword_rounds) from outside the LIVE logs: rounds of LIVEs older than the logs, and what
 * the clips pipeline (tiktok-clips) finds in a recording - where the round is in it, a clip, interesting moments.
 *
 *   php artisan guessword:rounds-import /tmp/rounds.json [--room=1] [--sync]
 *
 * The file: a JSON array of {live_key, round, ...} (RoundsArchive::IMPORTABLE). live_key = the LIVE log's file
 * name for a logged LIVE, or "rec:<recording id>" for one known only from its recording. --sync first refreshes
 * the room's rounds from the logs (so rows of logged LIVEs exist before their clips are attached).
 */
class RoundsImportCommand extends Command
{
    protected $signature = 'guessword:rounds-import {file : JSON array of rounds}
        {--room=1 : the room id (guessword_rooms.id)}
        {--sync : refresh the rounds from the LIVE logs first}';

    protected $description = 'Add or update rounds of the archive\'s rounds table (old LIVEs, clips, moments)';

    public function handle(RoundsArchive $rounds): int
    {
        $room = GuesswordRoom::find((int) $this->option('room'));
        if (! $room) {
            $this->error('no such room');

            return self::FAILURE;
        }
        if ($this->option('sync')) {
            $this->info('synced from logs: '.$rounds->sync($room).' rounds');
        }
        $rows = json_decode((string) @file_get_contents($this->argument('file')), true);
        if (! is_array($rows)) {
            $this->error('not a JSON array: '.$this->argument('file'));

            return self::FAILURE;
        }
        $r = $rounds->import($room, $rows);
        $this->info("created {$r['created']}, updated {$r['updated']}");
        foreach ($r['errors'] as $e) {
            $this->warn($e);
        }

        return $r['errors'] ? self::FAILURE : self::SUCCESS;
    }
}
