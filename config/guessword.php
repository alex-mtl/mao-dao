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

    // "Get the markup" of a LIVE (docs/games/guessword.md, "Speech jobs"): sound from the LIVE Center recording on this server,
    // Whisper on the owner's Kaggle account (the GPU quota is theirs: only super admins start it)
    'speech' => [
        'kaggle_token' => env('KAGGLE_TOKEN'),
        'kaggle_user' => env('KAGGLE_USER', 'kimalexandermontreal'),
        'kernel' => env('KAGGLE_SPEECH_KERNEL', 'whisper-transcribe'),
        'part_s' => 3600,                 // one sound part = one hour of the recording (parts are pulled in parallel)
        'parallel' => (int) env('GUESSWORD_SPEECH_PARALLEL', 2),
        'ffmpeg' => env('GUESSWORD_SPEECH_FFMPEG', 'ffmpeg'),
        'dir' => storage_path('app/guessword/speech'),
        'kaggle_max_min' => 720,          // only a guard for the worker: Kaggle's queue alone can take hours
        'dataset_wait_s' => 60,           // a fresh Kaggle dataset is not attachable for about a minute
    ],
];
