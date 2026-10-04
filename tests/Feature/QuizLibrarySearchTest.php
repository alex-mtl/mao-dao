<?php

use App\Models\Quiz;
use App\Models\Tag;
use App\Models\User;

function librarySearchTitles($test, array $query): array
{
    $user = User::factory()->create();

    $response = $test->actingAs($user)->get(route('library.index', $query))->assertOk();

    return collect($response->viewData('page')['props']['quizzes']['data'])->pluck('title')->all();
}

test('search matches a quiz by the name of one of its tags', function () {
    $history = Tag::factory()->create(['name' => 'History']);
    $math = Tag::factory()->create(['name' => 'Math']);

    $byTag = Quiz::factory()->published()->create(['title' => 'Ancient Rome', 'description' => 'Emperors.']);
    $byTag->tags()->attach($history);
    $other = Quiz::factory()->published()->create(['title' => 'Algebra Basics', 'description' => 'Equations.']);
    $other->tags()->attach($math);

    expect(librarySearchTitles($this, ['search' => 'history']))->toBe(['Ancient Rome']);
});

test('search matches a word that only appears in the description', function () {
    Quiz::factory()->published()->create(['title' => 'Alpha', 'description' => 'Covers volcanoes and tectonics.']);
    Quiz::factory()->published()->create(['title' => 'Beta', 'description' => 'Something unrelated.']);

    expect(librarySearchTitles($this, ['search' => 'volcanoes']))->toBe(['Alpha']);
});

test('search still matches the title', function () {
    Quiz::factory()->published()->create(['title' => 'Geography Sprint', 'description' => 'x']);
    Quiz::factory()->published()->create(['title' => 'Cooking 101', 'description' => 'y']);

    expect(librarySearchTitles($this, ['search' => 'geography']))->toBe(['Geography Sprint']);
});

test('search combines with the tag and language filters', function () {
    $history = Tag::factory()->create(['name' => 'History']);

    $en = Quiz::factory()->published()->create(['title' => 'Napoleon', 'language' => 'en', 'description' => 'history of France']);
    $ru = Quiz::factory()->published()->create(['title' => 'Napoleon RU', 'language' => 'ru', 'description' => 'history of France']);
    $noTag = Quiz::factory()->published()->create(['title' => 'Napoleon Untagged', 'language' => 'en', 'description' => 'history of France']);
    $en->tags()->attach($history);
    $ru->tags()->attach($history);

    expect(librarySearchTitles($this, ['search' => 'history', 'tag' => $history->id, 'language' => 'en']))
        ->toBe(['Napoleon']);
});

test('search never returns drafts and treats percent signs literally', function () {
    Quiz::factory()->create(['title' => 'Secret history draft', 'status' => 'draft']);
    Quiz::factory()->published()->create(['title' => '100% Trivia', 'description' => 'z']);
    Quiz::factory()->published()->create(['title' => 'Other', 'description' => 'z']);

    expect(librarySearchTitles($this, ['search' => 'history']))->toBe([]);
    expect(librarySearchTitles($this, ['search' => '100%']))->toBe(['100% Trivia']);
});
