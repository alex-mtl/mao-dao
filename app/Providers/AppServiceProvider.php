<?php

namespace App\Providers;

use App\Models\MafiaRoom;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use SocialiteProviders\Manager\SocialiteWasCalled;
use SocialiteProviders\Telegram\TelegramExtendSocialite;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(Request $request): void
    {
        Vite::prefetch(concurrency: 3);

        Event::listen(SocialiteWasCalled::class, [TelegramExtendSocialite::class, 'handle']);

        // Signed-out visitors on a members-only page go to the login form
        // (the "intended URL" mechanism brings them back afterwards).
        //
        // One exception: the play/lobby address of a room that does not
        // exist. Sending a signed-out visitor to a login form for a game
        // that is not there is misleading (and after logging in they would
        // only land on a 404), so they go to the public room address, which
        // answers with the "this game doesn't exist" page.
        Authenticate::redirectUsing(function (Request $request) {
            if ($request->is('mafia/*/play', 'mafia/*/lobby')) {
                $code = strtoupper((string) $request->segment(2));

                if (! MafiaRoom::where('room_code', $code)->exists()) {
                    return route('mafia.show', $code);
                }
            }

            return route('login');
        });

        // Behind nginx the app is reached over https; generate https URLs.
        // (The root URL itself comes from the request host, so mao-dao.com and
        // www.mao-dao.com both work — there is no longer any path prefix.)
        if ($this->app->environment('production')) {
            URL::forceScheme('https');
        }
    }
}
