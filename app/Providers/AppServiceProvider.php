<?php

namespace App\Providers;

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

        // Vite's compiled assets physically exist ONLY under
        // /var/www/quiz/public/build, reachable ONLY via the /quiz/build/
        // nginx alias (there is no equivalent /mafia/build/ or bare
        // /build/ location — see the "Mafia Extension" plan §2.1's note
        // that no separate asset path was ever needed). But `@vite()`'s
        // default asset-path resolver is just the `asset()` helper, which
        // *does* respect rootUrlFor()'s per-request forced root below —
        // so on any real /mafia/* page (not a redirect-to-login), forced
        // root is bare and every entry <script>/<link> tag 404'd at
        // "https://.../build/assets/..." instead of ".../quiz/build/...".
        // Confirmed directly in production. This resolver makes Vite's
        // own asset URLs always use the quiz root, independent of
        // whichever root the current request happens to force.
        Vite::createAssetPathsUsing(
            fn (string $path, ?bool $secure = null) => rtrim(config('app.url'), '/').'/'.ltrim($path, '/'),
        );

        Event::listen(SocialiteWasCalled::class, [TelegramExtendSocialite::class, 'handle']);

        // The Breeze-scaffolded `login` route is shared, un-prefixed (just
        // "/login") — under /quiz that works because /quiz is stripped as
        // a base path before Laravel's router ever sees it (the router
        // matches plain "/login"). /mafia is deliberately NOT stripped
        // that way (see the mafia nginx block's comment on SCRIPT_NAME) —
        // its own routes need the literal "mafia/" prefix intact — which
        // means there is no "mafia/login" route to redirect an
        // unauthenticated /mafia/* visitor to. Rather than duplicate the
        // entire auth route set under a second prefix for one shared
        // account system, every unauthenticated redirect explicitly goes
        // to the one real login page under /quiz; Laravel's normal
        // "intended URL" session mechanism still bounces them back to
        // whatever /mafia/... page they actually wanted once logged in.
        Authenticate::redirectUsing(fn () => rtrim(config('app.url'), '/').'/login');

        // When deployed under a URL path prefix (e.g. https://example.com/quiz),
        // nginx's SCRIPT_NAME-based base path detection is unreliable, so force
        // every generated URL (route(), url(), asset(), Ziggy) to use a fixed
        // root — but this app is mounted at two sibling prefixes from the same
        // codebase (/quiz and /mafia, see the "Mafia Extension" plan §2.1), so
        // that root can't be one hardcoded constant. It's derived per-request
        // instead, from whichever prefix actually served the request.
        if ($this->app->environment('production')) {
            URL::forceRootUrl($this->rootUrlFor($request));
            URL::forceScheme('https');
        }
    }

    private function rootUrlFor(Request $request): string
    {
        if (str_starts_with($request->path(), 'mafia')) {
            // Unlike /quiz's routes (defined bare, with "/quiz" stripped as
            // a base path by nginx before Laravel's router sees them),
            // Mafia's own routes carry a literal "mafia/" prefix in their
            // URI (routes/web.php). Forcing the root to ".../mafia" here
            // would make route()/Ziggy double it into "/mafia/mafia/..."
            // — confirmed via a real production 404 on room creation
            // (POST /mafia/mafia/rooms) — so the forced root for mafia
            // requests must be the bare scheme+host, no path suffix.
            return 'https://'.$request->getHost();
        }

        return config('app.url');
    }
}
