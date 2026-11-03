<?php

declare(strict_types=1);

namespace App\Games\Guessword\Console;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Services\Bonuses;
use Illuminate\Console\Command;

/**
 * Bonuses on a viewer's account (free hints spent in chat with "подсказка", cakes and the rest launched by a
 * club emote). The database keeps them (Bonuses), the engine gets the new balance:
 *
 *   php artisan guessword:hints <tiktok login> [n=1] [--kind=hint|cake|...] [--room=<id | gw<id> | streamer's TikTok login>]
 *
 * Also `guessword:bonus`. The viewer is their TikTok login (uniqueId, "@" and case don't matter). --room may be
 * left out while there is only one room. A negative n takes away (never below 0). The room page's
 * "Players' bonuses" tab does the same.
 */
class AddHintsCommand extends Command
{
    protected $signature = 'guessword:hints {viewer : the viewer\'s TikTok login}
        {n=1 : how many (negative: take away)}
        {--kind=hint : hint, cake, boost, ... (config guessword.bonus_kinds)}
        {--room= : room id, gw<id> or the streamer\'s TikTok login (not needed with one room)}';

    protected $aliases = ['guessword:bonus'];

    protected $description = 'Put hints (or another bonus) on a Guess the Word viewer\'s account';

    public function handle(Bonuses $bonuses): int
    {
        $viewer = Bonuses::viewerId((string) $this->argument('viewer'));
        $n = filter_var($this->argument('n'), FILTER_VALIDATE_INT);
        $kind = (string) $this->option('kind');
        if ($viewer === '' || $n === false || $n === 0 || ! in_array($kind, Bonuses::kinds(), true)) {
            $this->error('Usage: guessword:hints <tiktok login> [n != 0] [--kind='.implode('|', Bonuses::kinds()).'] [--room=...]');

            return self::FAILURE;
        }

        $room = $this->room((string) $this->option('room'));
        if (! $room) {
            return self::FAILURE;
        }

        $balance = $bonuses->change($room, $viewer, $kind, $n, 'console');
        $this->info(sprintf('%s (room %s, @%s): %s %+d, on account now %d',
            $viewer, $room->engineId(), $room->tiktok_username ?: '-', $kind, $n, $balance));

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
