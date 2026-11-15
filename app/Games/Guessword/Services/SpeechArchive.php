<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Models\GuesswordSpeech;

/**
 * The host's speech of each LIVE for the clip form: words with times in the LIVE log's seconds (the game's announcer
 * is cut out before the import). Made by tiktok-clips (Whisper on Kaggle) and loaded with `guessword:speech-import`.
 */
class SpeechArchive
{
    /** rows: [{live_key, recording?, words: [[start, end, word], ...]}]; returns [stored, errors] */
    public function import(GuesswordRoom $room, array $rows): array
    {
        $stored = 0;
        $errors = [];
        foreach ($rows as $i => $r) {
            if (! is_array($r) || empty($r['live_key']) || ! is_array($r['words'] ?? null)) {
                $errors[] = "#{$i}: live_key and words are required";

                continue;
            }
            $words = [];
            foreach ($r['words'] as $w) {
                if (is_array($w) && count($w) >= 3 && is_numeric($w[0]) && is_numeric($w[1]) && trim((string) $w[2]) !== '') {
                    $words[] = [round((float) $w[0], 2), round((float) $w[1], 2), trim((string) $w[2])];
                }
            }
            usort($words, fn ($a, $b) => $a[0] <=> $b[0]);
            GuesswordSpeech::updateOrCreate(
                ['room_id' => $room->id, 'live_key' => (string) $r['live_key']],
                ['recording' => $r['recording'] ?? null, 'word_count' => count($words), 'words' => $words],
            );
            $stored++;
        }

        return [$stored, $errors];
    }

    /** the LIVEs of the room that have speech */
    public function keys(GuesswordRoom $room): array
    {
        return GuesswordSpeech::where('room_id', $room->id)->pluck('live_key')->all();
    }

    /** the words that start in [from, to] (LIVE seconds), or null when the LIVE has no speech */
    public function slice(GuesswordRoom $room, string $liveKey, float $from, float $to): ?array
    {
        $row = GuesswordSpeech::where('room_id', $room->id)->where('live_key', $liveKey)->first();
        if (! $row) {
            return null;
        }

        return array_values(array_filter($row->words, fn ($w) => $w[0] >= $from && $w[0] <= $to));
    }
}
