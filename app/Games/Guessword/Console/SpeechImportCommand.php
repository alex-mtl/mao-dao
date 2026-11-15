<?php

declare(strict_types=1);

namespace App\Games\Guessword\Console;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Services\SpeechArchive;
use Illuminate\Console\Command;

/**
 * The host's speech of LIVEs for the archive's clip form (guessword_speech), made by tiktok-clips/tools/speech-export.js:
 *
 *   php artisan guessword:speech-import /tmp/speech.json [--room=1]
 *
 * The file: a JSON array of {live_key, recording, words: [[start, end, word], ...]}; times are the LIVE log's
 * seconds, the game's announcer already removed. live_key as in the rounds table.
 */
class SpeechImportCommand extends Command
{
    protected $signature = 'guessword:speech-import {file : JSON array of LIVEs with words}
        {--room=1 : the room id (guessword_rooms.id)}';

    protected $description = 'Load the host\'s transcribed speech of LIVEs for the archive\'s clip form';

    public function handle(SpeechArchive $speech): int
    {
        $room = GuesswordRoom::find((int) $this->option('room'));
        if (! $room) {
            $this->error('no such room');

            return self::FAILURE;
        }
        $rows = json_decode((string) @file_get_contents($this->argument('file')), true);
        if (! is_array($rows)) {
            $this->error('not a JSON array: '.$this->argument('file'));

            return self::FAILURE;
        }
        [$stored, $errors] = $speech->import($room, array_is_list($rows) ? $rows : [$rows]);
        $this->info("stored {$stored}");
        foreach ($errors as $e) {
            $this->warn($e);
        }

        return $errors ? self::FAILURE : self::SUCCESS;
    }
}
