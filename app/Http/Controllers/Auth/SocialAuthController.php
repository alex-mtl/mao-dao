<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Socialite\Contracts\User as SocialiteUser;
use Laravel\Socialite\Facades\Socialite;

class SocialAuthController extends Controller
{
    /** @var list<string> */
    private const PROVIDERS = ['google', 'facebook', 'telegram'];

    /**
     * Redirect the user to the given OAuth provider.
     *
     * Not used for Telegram: its login widget initiates the flow itself
     * and redirects the browser straight to the callback route.
     */
    public function redirect(string $provider): RedirectResponse
    {
        abort_unless(in_array($provider, ['google', 'facebook'], true), 404);

        return Socialite::driver($provider)->redirect();
    }

    public function callback(string $provider): RedirectResponse
    {
        abort_unless(in_array($provider, self::PROVIDERS, true), 404);

        try {
            $socialiteUser = Socialite::driver($provider)->user();
        } catch (\Throwable $e) {
            return redirect()->route('login')->withErrors([
                'email' => __('auth.failed'),
            ]);
        }

        $user = $this->findOrCreateUser($provider, $socialiteUser);

        Auth::login($user, remember: true);

        return redirect()->intended(route('dashboard'));
    }

    private function findOrCreateUser(string $provider, SocialiteUser $socialiteUser): User
    {
        $existing = SocialAccount::where('provider', $provider)
            ->where('provider_user_id', $socialiteUser->getId())
            ->first();

        if ($existing) {
            return $existing->user;
        }

        $email = $socialiteUser->getEmail();

        // Telegram never provides an email; link by email for providers
        // that do, so a user who already registered with the same
        // verified email doesn't end up with a second account.
        $user = $email ? User::where('email', $email)->first() : null;

        if (! $user) {
            $user = User::create([
                'name' => $socialiteUser->getName()
                    ?: $socialiteUser->getNickname()
                    ?: 'User',
                'email' => $email ?: sprintf(
                    '%s-%s@users.noreply.quiz-platform.local',
                    $provider,
                    $socialiteUser->getId(),
                ),
                'password' => Str::random(40),
                'email_verified_at' => $email ? now() : null,
            ]);
        }

        $user->socialAccounts()->create([
            'provider' => $provider,
            'provider_user_id' => $socialiteUser->getId(),
        ]);

        return $user;
    }
}
