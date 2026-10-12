<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class ResendVerificationController extends Controller
{
    /**
     * Send a fresh confirmation link to an address that registered but never
     * confirmed — including an account already disabled by the deadline
     * (clicking the new link brings it back). The reply is the same whether
     * or not the address exists, so this can't be used to probe for users.
     */
    public function __invoke(Request $request): RedirectResponse
    {
        $request->validate(['email' => ['required', 'string', 'email']]);

        $user = User::where('email', strtolower($request->string('email')->toString()))->first();

        if ($user && ! $user->hasVerifiedEmail() && ! $user->hasPlaceholderEmail()) {
            // A disabled account has an expired deadline; make sure it has
            // one at all so the restart below gives it a new full period.
            if ($user->verification_expires_at === null) {
                $user->forceFill(['verification_expires_at' => now()])->save();
            }

            $user->sendEmailVerificationNotification();
        }

        return back()->with('status', __('account.resend_generic'));
    }
}
