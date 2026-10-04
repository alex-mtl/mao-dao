<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redirect;
use Illuminate\Validation\ValidationException;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

class ImageController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $request->validate([
            'image' => [
                'required',
                'image',
                'mimes:jpeg,png,webp,gif',
                'max:'.User::MAX_IMAGE_SIZE_KB,
            ],
        ]);

        $user = $request->user();

        if ($user->getMedia('images')->count() >= User::MAX_COLLECTION_IMAGES) {
            throw ValidationException::withMessages([
                'image' => __('profile.image_collection_full'),
            ]);
        }

        $user->addMediaFromRequest('image')->toMediaCollection('images');

        return Redirect::route('profile.edit');
    }

    public function destroy(Request $request, Media $media): RedirectResponse
    {
        abort_unless(
            $media->model_type === User::class && $media->model_id === $request->user()->id,
            403,
        );

        $media->delete();

        return Redirect::route('profile.edit');
    }
}
