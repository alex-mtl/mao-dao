<?php

namespace App\Http\Controllers;

use App\Http\Requests\ProfileUpdateRequest;
use App\Models\Tag;
use App\Models\User;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Redirect;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class ProfileController extends Controller
{
    /**
     * Display the user's profile form.
     */
    public function edit(Request $request): Response
    {
        $user = $request->user();

        return Inertia::render('Profile/Edit', [
            'mustVerifyEmail' => $user instanceof MustVerifyEmail,
            'status' => session('status'),
            'tags' => Tag::orderBy('name')->get(['id', 'name']),
            'userTagIds' => $user->tags()->pluck('tags.id'),
            'profilePhotoUrl' => $user->getFirstMediaUrl('profile') ?: null,
            'images' => $user->getMedia('images')->map(fn ($media) => [
                'id' => $media->id,
                'url' => $media->getUrl(),
                'name' => $media->name,
            ]),
            'imageLimit' => User::MAX_COLLECTION_IMAGES,
            'canDeleteAccount' => $user->isSuperAdmin(),
        ]);
    }

    /**
     * Update the user's profile information.
     */
    public function update(ProfileUpdateRequest $request): RedirectResponse
    {
        $request->user()->fill($request->validated());

        if ($request->user()->isDirty('email')) {
            $request->user()->email_verified_at = null;
        }

        $request->user()->save();

        return Redirect::route('profile.edit');
    }

    /**
     * Update the user's preferred UI language.
     */
    public function updateLanguage(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'ui_language' => ['required', Rule::in(config('locales.supported'))],
        ]);

        $request->user()->update($validated);

        return Redirect::route('profile.edit');
    }

    /**
     * Update the user's preferred color scheme.
     */
    public function updateColorScheme(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'color_scheme' => ['required', Rule::in(config('color_schemes.supported'))],
        ]);

        $request->user()->update($validated);

        return Redirect::route('profile.edit');
    }

    /**
     * Update the user's selected tags/interests.
     */
    public function updateTags(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'tag_ids' => ['array'],
            'tag_ids.*' => ['integer', Rule::exists('tags', 'id')],
        ]);

        $request->user()->tags()->sync($validated['tag_ids'] ?? []);

        return Redirect::route('profile.edit');
    }

    /**
     * Delete the user's account.
     */
    public function destroy(Request $request): RedirectResponse
    {
        abort_unless($request->user()->isSuperAdmin(), 403);

        $request->validate([
            'password' => ['required', 'current_password'],
        ]);

        $user = $request->user();

        Auth::logout();

        $user->delete();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return Redirect::to('/');
    }
}
