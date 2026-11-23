<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use RuntimeException;
use Symfony\Component\Process\Process;

/**
 * The sound of a LIVE Center recording: HLS segments carry video and sound together, so the whole stream is read, but only the
 * sound is kept (Opus mono 16 kHz, ~11 MB per hour). The recording is cut into parts of config('guessword.speech.part_s') seconds
 * pulled by a few parallel ffmpeg processes at low priority (the box is shared). Parts already made are kept (a restart resumes).
 */
class SpeechAudio
{
    /** @return array<int, array{file: string, offset: int}> the parts in order; $progress(done, total) after each part */
    public function extract(string $m3u8, int $duration, string $dir, ?callable $progress = null): array
    {
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new RuntimeException('cannot create '.$dir);
        }
        $len = (int) config('guessword.speech.part_s');
        $parts = [];
        for ($i = 0, $at = 0; $at < $duration; $i++, $at += $len) {
            $parts[] = ['file' => sprintf('part_%02d.ogg', $i), 'offset' => $at, 'len' => min($len, $duration - $at)];
        }
        $todo = array_values(array_filter($parts, fn ($p) => ! is_file("$dir/{$p['file']}.empty") && (! is_file("$dir/{$p['file']}") || filesize("$dir/{$p['file']}") < 1000)));
        $done = count($parts) - count($todo);
        $progress && $progress($done, count($parts));
        $running = [];
        while ($todo || $running) {
            while ($todo && count($running) < max(1, (int) config('guessword.speech.parallel'))) {
                $p = array_shift($todo);
                $tmp = "$dir/{$p['file']}.part";
                $cmd = [
                    config('guessword.speech.ffmpeg'), '-nostdin', '-loglevel', 'error', '-y', '-ss', (string) $p['offset'], '-t', (string) $p['len'],
                    '-i', $m3u8, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', '-f', 'ogg', $tmp,
                ];
                $proc = new Process(PHP_OS_FAMILY === 'Windows' ? $cmd : array_merge(['nice', '-n', '10'], $cmd), null, null, null, $p['len'] * 3 + 600);
                $proc->start();
                $running[] = [$proc, $p, $tmp];
            }
            usleep(500000);
            foreach ($running as $k => [$proc, $p, $tmp]) {
                if ($proc->isRunning()) {
                    continue;
                }
                unset($running[$k]);
                if ($proc->getExitCode() === 0 && trim($proc->getErrorOutput()) === '' && (! is_file($tmp) || filesize($tmp) < 1000)) {
                    // ffmpeg is happy but there is no sound there: the recording is shorter than its playlist claims (the tail was
                    // not stored) - skip this part, mark ".empty" so a restart does not pull it again
                    is_file($tmp) && unlink($tmp);
                    touch("$dir/{$p['file']}.empty");
                    $progress && $progress(++$done, count($parts));

                    continue;
                }
                if ($proc->getExitCode() !== 0 || ! is_file($tmp) || filesize($tmp) < 1000) {
                    foreach ($running as [$other]) {
                        $other->stop(1);
                    }
                    // ffmpeg echoes the address (with its signature) in its messages: never keep it
                    throw new RuntimeException('ffmpeg failed on '.$p['file'].': '.mb_substr(preg_replace('#https?://\S+#', '<url>', $proc->getErrorOutput()), 0, 300));
                }
                rename($tmp, "$dir/{$p['file']}");
                $progress && $progress(++$done, count($parts));
            }
        }

        $parts = array_values(array_filter($parts, fn ($p) => is_file("$dir/{$p['file']}")));
        if (! $parts) {
            throw new RuntimeException('the recording has no sound');
        }

        return array_map(fn ($p) => ['file' => $p['file'], 'offset' => $p['offset']], $parts);
    }
}
