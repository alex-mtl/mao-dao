<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;
use Symfony\Component\Process\Process;

/**
 * The sound of a LIVE Center recording: HLS segments carry video and sound together, so the whole stream is read, but only the
 * sound is kept (Opus mono 16 kHz, ~11 MB per hour). The recording is cut into parts of config('guessword.speech.part_s') seconds
 * pulled by a few parallel ffmpeg processes at low priority (the box is shared). Parts already made are kept (a restart resumes).
 */
class SpeechAudio
{
    /**
     * Cuts the recording's playlist into one local playlist per part by its segments (EXTINF sums), so no time seek is needed: a
     * LIVE recording has dozens of timestamp breaks (DISCONTINUITY) after which `-ss` lands past the real sound and returns an empty
     * file. A part starts at its first segment's start (up to one segment, ~4 s, off the round hour) and that is its offset.
     *
     * @return array<int, array{file: string, offset: int, len: int, src: string}> empty when the address is not a plain media playlist
     */
    private function playlistParts(string $m3u8, int $len, string $dir): array
    {
        try {
            $r = Http::timeout(60)->get($m3u8);
        } catch (\Throwable) {
            return [];
        }
        if (! $r->ok() || ! str_contains($r->body(), '#EXTINF')) {
            return [];
        }
        $base = preg_replace('#[^/]*$#', '', strtok($m3u8, '?'));
        $header = ['#EXTM3U', '#EXT-X-VERSION:6'];
        $target = 5;
        $segs = [];   // [start, duration, lines (tags + uri)]
        $t = 0.0;
        $pending = [];
        $lines = preg_split('/\r?\n/', trim($r->body()));
        foreach ($lines as $i => $l) {
            if (str_starts_with($l, '#EXT-X-TARGETDURATION:')) {
                $target = (int) substr($l, 22);
            } elseif (str_starts_with($l, '#EXT-X-DISCONTINUITY') && ! str_contains($l, 'SEQUENCE')) {
                $pending[] = '#EXT-X-DISCONTINUITY';
            } elseif (str_starts_with($l, '#EXTINF:')) {
                $d = (float) substr($l, 8);
                $uri = $lines[$i + 1] ?? '';
                $uri = preg_match('#^https?://#', $uri) ? $uri : $base.$uri;
                $segs[] = [$t, $d, array_merge($pending, [$l, $uri])];
                $pending = [];
                $t += $d;
            }
        }
        if (! $segs) {
            return [];
        }
        $groups = [];
        foreach ($segs as $s) {
            $groups[intdiv((int) $s[0], $len)][] = $s;
        }
        $parts = [];
        foreach ($groups as $g) {
            $n = count($parts);
            $src = "$dir/".sprintf('part_%02d.m3u8', $n);
            $body = array_merge($header, ['#EXT-X-TARGETDURATION:'.$target, '#EXT-X-PLAYLIST-TYPE:VOD']);
            foreach ($g as $s) {
                $body = array_merge($body, $s[2]);
            }
            file_put_contents($src, implode("\n", array_merge($body, ['#EXT-X-ENDLIST'])));
            $parts[] = ['file' => sprintf('part_%02d.ogg', $n), 'offset' => (int) round($g[0][0]), 'len' => (int) round(array_sum(array_column($g, 1))), 'src' => $src];
        }

        return $parts;
    }

    /** @return array<int, array{file: string, offset: int}> the parts in order; $progress(done, total) after each part */
    public function extract(string $m3u8, int $duration, string $dir, ?callable $progress = null): array
    {
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new RuntimeException('cannot create '.$dir);
        }
        $len = (int) config('guessword.speech.part_s');
        $parts = $this->playlistParts($m3u8, $len, $dir);
        if (! $parts) {   // not a plain playlist: seek by time (-ss), which is unreliable across timestamp breaks
            for ($i = 0, $at = 0; $at < $duration; $i++, $at += $len) {
                $parts[] = ['file' => sprintf('part_%02d.ogg', $i), 'offset' => $at, 'len' => min($len, $duration - $at), 'src' => $m3u8, 'ss' => true];
            }
        }
        $todo = array_values(array_filter($parts, fn ($p) => ! is_file("$dir/{$p['file']}.empty") && (! is_file("$dir/{$p['file']}") || filesize("$dir/{$p['file']}") < 1000)));
        $done = count($parts) - count($todo);
        $progress && $progress($done, count($parts));
        $running = [];
        while ($todo || $running) {
            while ($todo && count($running) < max(1, (int) config('guessword.speech.parallel'))) {
                $p = array_shift($todo);
                $tmp = "$dir/{$p['file']}.part";
                $cmd = array_merge(
                    [config('guessword.speech.ffmpeg'), '-nostdin', '-loglevel', 'error', '-y'],
                    ! empty($p['ss']) ? ['-ss', (string) $p['offset'], '-t', (string) $p['len']] : ['-protocol_whitelist', 'file,http,https,tcp,tls,crypto'],
                    ['-i', $p['src'], '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', '-f', 'ogg', $tmp],
                );
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
