<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use DateTimeImmutable;
use DateTimeZone;

/**
 * LIVE logs rebuilt from the engine's systemd journal (R2 archive, services/journal-archive/), for the
 * streams before the engine wrote its own LIVE logs (29.10.2026). Same JSONL shape as the engine's
 * (docs/games/guessword.md, "Live logs"), only what the archive and the digest use: live_start,
 * round_start, winner, plane, balloon, cake. The journal has nicknames only: users get uid "" and no avatar.
 *
 * One LIVE = one TikTok room id of an engine room, from "[tiktok] connected" to the last event before
 * TikTok says the account is not live any more (a reconnect to the same LIVE continues it).
 */
class JournalLives
{
    private const LINE = '/^(\S+) \S+ \S+: <(gw\d+)> \[(\w+)\] (.*)$/u';

    /** lines of `journalctl -o short-iso` (any order of days, oldest first) -> [room => [file => [events]]] */
    public function parse(iterable $lines, string $tz = 'America/Toronto'): array
    {
        $zone = new DateTimeZone($tz);
        $pending = $current = $lives = [];
        foreach ($lines as $line) {
            if (! preg_match(self::LINE, rtrim((string) $line, "\r\n"), $m)) {
                continue;
            }
            [, $time, $room, $tag, $msg] = $m;
            $at = new DateTimeImmutable($time);
            $epoch = (float) $at->format('U');

            if ($tag === 'tiktok') {
                if (preg_match('/^connecting to @(\S+) \(room (\d+)\)/', $msg, $c)) {
                    $pending[$room] = [$c[1], $c[2]];
                } elseif (str_starts_with($msg, 'connected to @') && isset($pending[$room])) {
                    [$user, $tt] = $pending[$room];
                    $key = $room.'|'.$tt;
                    $lives[$key] ??= ['room' => $room, 'tt' => $tt, 'start' => $epoch, 'events' => [[
                        't' => $at->setTimezone($zone)->format('Y-m-d\TH:i:s.vP'), 's' => 0.0, 'type' => 'live_start',
                        'epoch' => $epoch, 'tiktok_room' => $tt, 'username' => $user,
                    ]]];
                    $current[$room] = $key;
                } elseif (str_contains($msg, 'is not live')) {
                    unset($current[$room]);               // the LIVE is over
                }

                continue;
            }
            if ($tag === 'room' && str_starts_with($msg, 'stopped')) {
                unset($current[$room]);

                continue;
            }
            $key = $current[$room] ?? null;
            $event = $key ? $this->event($tag, $msg) : null;
            if ($event) {
                $s = round($epoch - $lives[$key]['start'], 1);
                $lives[$key]['events'][] = ['t' => $at->setTimezone($zone)->format('Y-m-d\TH:i:s.vP'), 's' => $s] + $event;
            }
        }

        $out = [];
        foreach ($lives as $live) {
            // a reconnect blip or a LIVE without the game: under 10 events and no win
            if (count($live['events']) < 10 && ! in_array('winner', array_column($live['events'], 'type'), true)) {
                continue;
            }
            $start = (new DateTimeImmutable('@'.(int) $live['start']))->setTimezone($zone);
            $out[$live['room']][$start->format('Y-m-d_His').'_'.$live['tt'].'.jsonl'] = $live['events'];
        }

        return $out;
    }

    private function event(string $tag, string $msg): ?array
    {
        $user = fn (string $name) => ['uid' => '', 'id' => '', 'name' => $name];

        return match (true) {
            $tag === 'guess' && (bool) preg_match('/^round (\d+) \(/', $msg, $m) => ['type' => 'round_start', 'round' => (int) $m[1]],
            $tag === 'guess' && (bool) preg_match('/^round (\d+) exact: word=(.*) winner=(.+)$/u', $msg, $m)
                => ['type' => 'winner', 'round' => (int) $m[1], 'user' => $user($m[3]), 'word' => $m[2]],
            $tag === 'plane' && (bool) preg_match('/^(.+): (\d+) likes -> auto plane$/u', $msg, $m) => ['type' => 'plane', 'user' => $user($m[1]), 'likes' => (int) $m[2]],
            $tag === 'balloons' && (bool) preg_match('/^#(\d+) for (.+) \((\d+) likes\)$/u', $msg, $m)
                => ['type' => 'balloon', 'user' => $user($m[2]), 'likes' => (int) $m[3], 'n' => (int) $m[1]],
            $tag === 'cake' && (bool) preg_match('/^(.+): (\d+) likes -> cake$/u', $msg, $m) => ['type' => 'cake', 'user' => $user($m[1]), 'likes' => (int) $m[2]],
            $tag === 'manual' && (bool) preg_match('/^(.+): (balloon|plane|cake)$/u', $msg, $m) => ['type' => $m[2], 'user' => $user($m[1]), 'manual' => true, 'count' => 1],
            default => null,
        };
    }
}
