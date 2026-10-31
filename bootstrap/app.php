<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withCommands([
        \App\Games\Guessword\Console\JournalLivesCommand::class,
        \App\Games\Guessword\Console\DailyStatsCommand::class,
        \App\Games\Guessword\Console\AddHintsCommand::class,
    ])
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->web(append: [
            \App\Http\Middleware\EnsureAccountIsActive::class,
            \App\Http\Middleware\HandleInertiaRequests::class,
            \Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets::class,
        ]);

        $middleware->alias([
            'race.player' => \App\Http\Middleware\ResolveRacePlayer::class,
            'mafia.player' => \App\Http\Middleware\ResolveMafiaPlayer::class,
            'mafia.spectator' => \App\Http\Middleware\ResolveMafiaSpectator::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // Styled error pages (inside the site's header) instead of the bare
        // framework screens. Mafia addresses get their own page that
        // explains "this game doesn't exist or you have no access" and keeps
        // the create/join controls on screen.
        $exceptions->respond(function (\Symfony\Component\HttpFoundation\Response $response, \Throwable $e, Request $request) {
            $status = $response->getStatusCode();

            $handled = in_array($status, [403, 404, 419, 429], true)
                || (in_array($status, [500, 503], true) && ! app()->hasDebugModeEnabled());

            if (! $handled || $request->is('api/*') || $request->expectsJson() || $request->is('internal/*')) {
                return $response;
            }

            $isMafia = $request->is('mafia/*') && in_array($status, [403, 404], true);

            try {
                $page = $isMafia
                    ? \Inertia\Inertia::render('Mafia/RoomUnavailable', [
                        'code' => strtoupper((string) $request->segment(2)) ?: null,
                    ])
                    : \Inertia\Inertia::render('Error', ['status' => $status]);

                return $page->toResponse($request)->setStatusCode($status);
            } catch (\Throwable) {
                return $response;
            }
        });
    })->create();
