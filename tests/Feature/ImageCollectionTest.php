<?php

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    Storage::fake('public');
});

test('a user can upload an image to their collection', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->post('/images', [
        'image' => UploadedFile::fake()->image('photo.jpg'),
    ])->assertRedirect();

    expect($user->fresh()->getMedia('images'))->toHaveCount(1);
});

test('an oversized image is rejected', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->post('/images', [
        'image' => UploadedFile::fake()->create('big.jpg', 6000, 'image/jpeg'),
    ]);

    $response->assertSessionHasErrors('image');
    expect($user->fresh()->getMedia('images'))->toHaveCount(0);
});

test('a non image file is rejected', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->post('/images', [
        'image' => UploadedFile::fake()->create('doc.pdf', 100, 'application/pdf'),
    ]);

    $response->assertSessionHasErrors('image');
});

test('the 100 image collection limit is enforced server side', function () {
    $user = User::factory()->create();

    for ($i = 0; $i < User::MAX_COLLECTION_IMAGES; $i++) {
        $user->addMedia(UploadedFile::fake()->image("photo{$i}.jpg"))->toMediaCollection('images');
    }

    $response = $this->actingAs($user)->post('/images', [
        'image' => UploadedFile::fake()->image('one-too-many.jpg'),
    ]);

    $response->assertSessionHasErrors('image');
    expect($user->fresh()->getMedia('images'))->toHaveCount(User::MAX_COLLECTION_IMAGES);
});

test('a user can only delete their own images', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $media = $owner->addMedia(UploadedFile::fake()->image('photo.jpg'))->toMediaCollection('images');

    $this->actingAs($stranger)->delete("/images/{$media->id}")->assertForbidden();
    $this->actingAs($owner)->delete("/images/{$media->id}")->assertRedirect();

    expect($owner->fresh()->getMedia('images'))->toHaveCount(0);
});
