<?php

declare(strict_types=1);

/*
 * Guess the Word for TikTok LIVE streamers (third game, docs/games/guessword.md).
 * The game itself runs in the Python sidecar stream-engine/ (one process, many rooms);
 * Laravel owns the rooms, their settings and who may use them.
 */
return [
    // where Laravel reaches the engine (server-to-server, never the browser)
    'engine_url' => env('GUESSWORD_ENGINE_URL', env('APP_ENV') === 'testing' ? 'http://engine.test' : 'http://127.0.0.1:8770'),
    // same value as INTERNAL_SECRET in stream-engine's environment
    'engine_secret' => env('GUESSWORD_ENGINE_SECRET'),
    // where nginx publishes the engine to browsers and TikTok LIVE Studio (= the engine's BASE_PATH)
    'public_path' => env('GUESSWORD_ENGINE_PUBLIC_PATH', '/guessword/engine'),

    // the Telegram bot (services/telegram-bot): rooms register there and get their key, which also
    // opens the word-ranker Lambdas. Secret = SSM /tiktok-tg-bot/platform-secret.
    'bot_url' => env('GUESSWORD_BOT_URL', env('APP_ENV') === 'testing' ? 'http://bot.test' : null),
    'bot_platform_secret' => env('GUESSWORD_BOT_PLATFORM_SECRET'),

    'languages' => ['en', 'ru', 'fr', 'es'],

    // what a viewer can have "on account" in a room (App\Games\Guessword\Services\Bonuses): the engine's
    // gift actions they launch themselves - "подсказка" or a club emote the streamer bound to the kind.
    // A new kind = the engine's stream-engine/app/bonuses.py KINDS too.
    'bonus_kinds' => ['hint', 'cake', 'boost', 'multi', 'balloon', 'plane', 'bomber', 'snowball'],
];
