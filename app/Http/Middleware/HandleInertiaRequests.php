<?php

namespace App\Http\Middleware;

use App\Services\NotificationFeedService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that is loaded on the first page visit.
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determine the current asset version.
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $locale = $request->user()->ui_language
            ?? $request->session()->get('locale')
            ?? config('locales.default');

        App::setLocale($locale);

        $colorScheme = $request->user()->color_scheme
            ?? $request->session()->get('color_scheme')
            ?? config('color_schemes.default');

        return [
            ...parent::share($request),
            'auth' => [
                'user' => $request->user()?->loadMissing('role'),
            ],
            // The shared nav (AuthenticatedLayout/NavigationDrawer) renders
            // on both /quiz and /mafia pages and links into both sections
            // — but AppServiceProvider::rootUrlFor() forces a single root
            // per request (whichever section served it), so route() calls
            // to the *other* section's routes come out wrong no matter
            // which way that single root is set. This constant, always-
            // correct quiz root lets those specific links override Ziggy's
            // per-request root explicitly — see useSectionRoutes.js.
            'quizUrl' => config('app.url'),
            'notifications_unread' => fn () => $request->user()
                ? app(NotificationFeedService::class)->unreadCount($request->user())
                : 0,
            'locale' => $locale,
            'available_locales' => config('locales.supported'),
            'locale_options' => collect(config('locales.supported'))
                ->map(fn (string $code) => [
                    'value' => $code,
                    'label' => config("locales.native_names.{$code}"),
                ])
                ->values(),
            'color_scheme' => $colorScheme,
            'color_scheme_options' => collect(config('color_schemes.supported'))
                ->map(fn (string $key) => [
                    'value' => $key,
                    'is_dark' => config("color_schemes.is_dark.{$key}"),
                ])
                ->values(),
        ];
    }
}
