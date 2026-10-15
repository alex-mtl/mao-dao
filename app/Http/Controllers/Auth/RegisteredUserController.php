<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class RegisteredUserController extends Controller
{
    /**
     * Display the registration view.
     */
    public function create(): Response
    {
        return Inertia::render('Auth/Register');
    }

    /**
     * Handle an incoming registration request.
     *
     * @throws ValidationException
     */
    public function store(Request $request): RedirectResponse
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|lowercase|email|max:255|unique:'.User::class,
            'password' => ['required', 'confirmed', Rules\Password::defaults()],
        ]);

        $locale = app()->getLocale();

        $user = User::create([
            'name' => $request->name,
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'ui_language' => in_array($locale, config('locales.supported'), true) ? $locale : config('locales.default'),
        ]);

        // The account may be used right away but has a deadline to confirm
        // the email (see User::emailVerificationState()). The `Registered`
        // event below sends the link.
        if (config('auth.verification.enforce_deadline')) {
            $user->forceFill([
                'verification_expires_at' => now()->addMinutes((int) config('auth.verification.expire', 1440)),
            ])->save();
        }

        event(new Registered($user));

        Auth::login($user);

        return redirect(route('welcome', absolute: false));
    }
}
