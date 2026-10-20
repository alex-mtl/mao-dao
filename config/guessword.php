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

    // Pilot access to the TikTok mode: these accounts (e-mails, comma separated) besides super admins.
    // Replaced later by the platform's "streamer pack" (see App\Services\Capabilities).
    'streamers' => array_values(array_filter(array_map(
        fn ($e) => strtolower(trim($e)),
        explode(',', (string) env('GUESSWORD_STREAMERS', '')),
    ))),

    'languages' => ['en', 'ru', 'fr', 'es'],
];
