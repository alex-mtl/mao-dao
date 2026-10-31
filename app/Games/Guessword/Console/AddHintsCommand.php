<?php

declare(strict_types=1);

namespace App\Games\Guessword\Console;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Services\EngineClient;
use Illuminate\Console\Command;
use Throwable;

/**
 * Hints on a viewer's account ("on account", spent in chat with "подсказка"). The engine keeps the
 * accounts and does the change; Laravel only tells it whom and how many:
 *
 *   php artisan guessword:hints <tiktok login> [n=1] [--room=<id | gw<id> | streamer's TikTok login>]
 *
 * The viewer is their TikTok login (uniqueId, "@" and case don't matter). --room may be left out while
 * there is only one room. A negative n takes hints away (never below 0).
 */
class AddHintsCommand extends Command
{
    protected $signature = 'guessword:hints {viewer : the viewer\'s TikTok login}
        {n=1 : how many hints (negative: take away)}
        {--room= : room id, gw<id> or the streamer\'s TikTok login (not needed with one room)}';

    protected $description = 'Put hints on a Guess the Word viewer\'s account (done by the engine)';

    public function handle(EngineClient $engine): int
    {
        $viewer = ltrim(trim((string) $this->argument('viewer')), '@');
        $n = filter_var($this->argument('n'), FILTER_VALIDATE_INT);
        if ($viewer === '' || $n === false || $n === 0) {
            $this->error('Usage: guessword:hints <tiktok login> [n != 0] [--room=...]');

            return self::FAILURE;
        }

        $room = $this->room((string) $this->option('room'));
        if (! $room) {
            return self::FAILURE;
        }

        try {
            $r = $engine->addHints($room, $viewer, $n);
        } catch (Throwable $e) {
            $this->error('engine: '.$e->getMessage());

            return self::FAILURE;
        }
        $this->info(sprintf('%s (room %s, @%s): %+d, on account now %d',
            $r['id'], $room->engineId(), $room->tiktok_username ?: '-', $n, $r['credits']));

        return self::SUCCESS;
    }

    private function room(string $given): ?GuesswordRoom
    {
        $given = ltrim(trim($given), '@');
        if ($given === '') {
            $rooms = GuesswordRoom::all();
            if ($rooms->count() === 1) {
                return $rooms->first();
            }
            $this->error('Several rooms — pass --room=:');
            foreach ($rooms as $r) {
                $this->line(sprintf('  %s  @%s', $r->engineId(), $r->tiktok_username ?: '-'));
            }

            return null;
        }
        $id = preg_match('/^(gw)?(\d+)$/i', $given, $m) ? (int) $m[2] : null;
        $room = ($id ? GuesswordRoom::find($id) : null)
            ?? GuesswordRoom::whereRaw('lower(tiktok_username) = ?', [mb_strtolower($given)])->first();
        if (! $room) {
            $this->error("No room \"{$given}\".");
        }

        return $room;
    }
}
