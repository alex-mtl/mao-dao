<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redirect;

class ProfilePhotoController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $request->validate([
            'photo' => [
                'required',
                'image',
                'mimes:jpeg,png,webp,gif',
                'max:'.User::MAX_IMAGE_SIZE_KB,
            ],
        ]);

        $request->user()
            ->addMediaFromRequest('photo')
            ->toMediaCollection('profile');

        return Redirect::route('profile.edit');
    }

    public function destroy(Request $request): RedirectResponse
    {
        $request->user()->clearMediaCollection('profile');

        return Redirect::route('profile.edit');
    }
}
