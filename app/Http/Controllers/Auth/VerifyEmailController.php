<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class VerifyEmailController extends Controller
{
    /**
     * Confirm the address the signed link was sent to. Deliberately not
     * behind `auth`: people open the link on their phone, in another
     * browser, or after the session ended. The route's `signed` middleware
     * plus the email hash are the proof; confirming never logs anyone in.
     */
    public function __invoke(Request $request, string $id, string $hash): RedirectResponse
    {
        $user = User::findOrFail($id);

        abort_unless(hash_equals(sha1($user->getEmailForVerification()), $hash), 403);

        if (! $user->hasVerifiedEmail()) {
            $user->markEmailAsVerified();
            $user->forceFill(['verification_expires_at' => null])->save();

            event(new Verified($user));
        }

        if (Auth::check() && Auth::id() === $user->id) {
            return redirect()->intended(route('dashboard', absolute: false).'?verified=1');
        }

        return redirect()->route('login')->with('status', __('account.confirmed_please_login'));
    }
}
