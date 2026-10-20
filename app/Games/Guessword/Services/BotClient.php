<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use App\Games\Guessword\Models\GuesswordRoom;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Laravel -> the Telegram bot (AWS Lambda, services/telegram-bot): registers a room as a game and
 * gets its key. The key lets the room use the bot (stream word, linking viewers, offered words) and
 * the word-ranker Lambdas (round tables) - without it the engine can't start rounds.
 */
class BotClient
{
    /** the room's key, registering the room on first use */
    public function ensureKey(GuesswordRoom $room): string
    {
        if (filled($room->tg_key)) {
            return $room->tg_key;
        }

        $url = config('guessword.bot_url');
        $secret = (string) config('guessword.bot_platform_secret');
        if (blank($url) || $secret === '') {
            throw new RuntimeException('GUESSWORD_BOT_URL / GUESSWORD_BOT_PLATFORM_SECRET are not configured.');
        }

        $key = Http::withHeaders(['X-Platform-Secret' => $secret])
            ->connectTimeout(3)->timeout(15)->acceptJson()
            ->post(rtrim($url, '/').'/platform/games', ['id' => $room->engineId(), 'lang' => $room->lang])
            ->throw()->json('game_key');
        if (blank($key)) {
            throw new RuntimeException('The bot returned no game key.');
        }

        $room->tg_key = $key;
        $room->save();

        return $key;
    }
}
