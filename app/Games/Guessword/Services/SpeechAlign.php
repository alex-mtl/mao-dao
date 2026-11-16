<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

/**
 * Whisper's words of a recording -> the host's words in the LIVE log's seconds (port of tiktok-clips/tools/speech-export.js):
 * the shift recording -> log, then the game's announcer (a synthetic voice: greeting, "Раунд N. Поехали", the winner) cut out.
 * Pure: no I/O.
 */
class SpeechAlign
{
    private const ANNOUNCER = '/добро пожаловать|привет|поехали|угадывает|победител|лидер|спасибо|ты в игре|подпиш/iu';

    /**
     * @param  array  $words  [{w, s, e}] in recording seconds
     * @param  array  $events  the LIVE log's digest events (LiveArchive::events): round_start / winner with 's'
     * @param  float  $epoch  unix time of the log's second 0
     * @param  float  $recStart  unix time of the recording's second 0
     * @return array{shift: float, refined: int, words: array, dropped: int}  words: [[start, end, word], ...] in log seconds
     */
    public function align(array $words, array $events, float $epoch, float $recStart): array
    {
        $words = array_values(array_filter(
            array_map(fn ($w) => ['w' => trim((string) ($w['w'] ?? '')), 's' => (float) ($w['s'] ?? 0), 'e' => (float) ($w['e'] ?? 0)], $words),
            fn ($w) => $w['w'] !== ''
        ));
        usort($words, fn ($a, $b) => $a['s'] <=> $b['s']);

        // clocks of TikTok and of the engine: recording second r = log second s + ($epoch - $recStart); refined by the announcer's own
        // "Раунд N. Поехали" heard in the recording (median over the rounds)
        $shift = $epoch - $recStart;
        $norm = fn (string $t) => preg_replace('/[^а-яёa-z0-9]/u', '', mb_strtolower($t));
        $nw = array_map(fn ($w) => $norm($w['w']), $words);
        $n = count($words);
        $at = fn (int $k) => $nw[$k] ?? '';
        $starts = [];
        foreach ($events as $e) {
            if (($e['type'] ?? null) === 'round_start' && isset($e['s'], $e['round'])) {
                $starts[(int) $e['round']] = (float) $e['s'];
            }
        }
        $deltas = [];
        for ($i = 0; $i < $n; $i++) {
            if ($nw[$i] === 'раунд' && $at($i + 2) === 'поехали' && ctype_digit($at($i + 1)) && isset($starts[(int) $nw[$i + 1]])) {
                $d = $words[$i]['s'] - $starts[(int) $nw[$i + 1]];
                if (abs($d - $shift) <= 90) {
                    $deltas[] = $d;
                }
            }
        }
        $refined = count($deltas);
        if ($refined >= 5) {
            sort($deltas);
            $shift = $deltas[intdiv($refined, 2)];
        }

        // windows of the announcer's voice (recording seconds): the log says when it speaks, the words inside must also sound like it
        $span = ['round_start' => 6, 'winner' => 6];
        $dropped = [];
        foreach ($events as $e) {
            if (! isset($span[$e['type'] ?? ''], $e['s'])) {
                continue;
            }
            $a = (float) $e['s'] + $shift - 0.5;
            $b = (float) $e['s'] + $shift + $span[$e['type']];
            $inside = array_keys(array_filter($words, fn ($w) => $w['s'] < $b && $w['e'] > $a));
            if ($inside && preg_match(self::ANNOUNCER, implode(' ', array_map(fn ($i) => $words[$i]['w'], $inside)))) {
                foreach ($inside as $i) {
                    $dropped[$i] = true;
                }
            }
        }
        // and by its fixed phrases, wherever the log has no moment for them ("Привет, <ник>, добро пожаловать", "Раунд N. Поехали",
        // "У нас есть победитель <ник> угадывает слово <слово>")
        $mark = function (int $i, int $j) use (&$dropped, $n) {
            for ($k = $i; $k <= $j && $k < $n; $k++) {
                $dropped[$k] = true;
            }
        };
        for ($i = 0; $i < $n; $i++) {
            if ($nw[$i] === 'привет') {
                for ($j = $i + 1; $j <= min($i + 7, $n - 2); $j++) {
                    if ($at($j) === 'добро' && (str_starts_with($at($j + 1), 'пожал') || str_starts_with($at($j + 2), 'пожал'))) {
                        $mark($i, str_starts_with($at($j + 1), 'пожал') ? $j + 1 : $j + 2);
                        break;
                    }
                }
            } elseif ($nw[$i] === 'раунд' && ctype_digit($at($i + 1)) && $at($i + 2) === 'поехали') {
                $mark($i, $i + 2);
            } elseif ($nw[$i] === 'раунд' && $at($i + 1) === 'поехали') {
                $mark($i, $i + 1);
            } elseif ($nw[$i] === 'у' && $at($i + 1) === 'нас' && $at($i + 2) === 'есть' && $at($i + 3) === 'победитель') {
                for ($j = $i + 4; $j <= min($i + 12, $n - 1); $j++) {
                    if (str_starts_with($at($j), 'угадыва') && $at($j + 1) === 'слово') {
                        $mark($i, min($j + 2, $n - 1));
                        break;
                    }
                }
            }
        }

        $kept = [];
        foreach ($words as $i => $w) {
            if (! isset($dropped[$i])) {
                $kept[] = [round($w['s'] - $shift, 2), round($w['e'] - $shift, 2), $w['w']];
            }
        }

        return ['shift' => round($shift, 2), 'refined' => $refined, 'words' => $kept, 'dropped' => count($dropped)];
    }
}
