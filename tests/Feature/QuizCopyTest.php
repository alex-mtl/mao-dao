<?php

use App\Models\Quiz;
use App\Models\Tag;
use App\Models\User;

function quizWithOneQuestion(User $owner, array $attributes = []): Quiz
{
    $quiz = Quiz::factory()->published()->create(array_merge(['user_id' => $owner->id], $attributes));
    $question = $quiz->questions()->create(['text' => 'Q?', 'order' => 0]);
    $question->answers()->create(['text' => 'A', 'is_correct' => true, 'order' => 0]);
    $question->answers()->create(['text' => 'B', 'is_correct' => false, 'order' => 1]);
    $question->answers()->create(['text' => 'C', 'is_correct' => false, 'order' => 2]);
    $question->answers()->create(['text' => 'D', 'is_correct' => false, 'order' => 3]);

    return $quiz->fresh(['questions.answers']);
}

test('copying a quiz creates an independent draft owned by the copier', function () {
    $owner = User::factory()->create();
    $copier = User::factory()->create();
    $tag = Tag::factory()->create();
    $original = quizWithOneQuestion($owner, ['allow_copying' => true]);
    $original->tags()->attach($tag);

    $response = $this->actingAs($copier)->post("/quizzes/{$original->id}/copy");

    $copy = Quiz::where('user_id', $copier->id)->first();
    $response->assertRedirect(route('quizzes.edit', $copy));
    expect($copy->id)->not->toBe($original->id);
    expect($copy->status)->toBe('draft');
    expect($copy->copied_from_quiz_id)->toBe($original->id);
    expect($copy->allow_copying)->toBeTrue();
    expect($copy->questions)->toHaveCount(1);
    expect($copy->questions->first()->id)->not->toBe($original->questions->first()->id);
    expect($copy->tags->pluck('id')->all())->toBe([$tag->id]);
});

test('editing the copy does not change the original and vice versa', function () {
    $owner = User::factory()->create();
    $copier = User::factory()->create();
    $original = quizWithOneQuestion($owner, ['allow_copying' => true]);

    $this->actingAs($copier)->post("/quizzes/{$original->id}/copy");
    $copy = Quiz::where('user_id', $copier->id)->first();

    $copy->update(['title' => 'Changed']);
    $copy->questions->first()->update(['text' => 'Changed question']);

    expect($original->fresh()->title)->not->toBe('Changed');
    expect($original->fresh()->questions->first()->text)->not->toBe('Changed question');
});

test('copying is blocked server-side when allow_copying is false, even via direct request', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $quiz = quizWithOneQuestion($owner, ['allow_copying' => false]);

    $this->actingAs($stranger)->post("/quizzes/{$quiz->id}/copy")->assertForbidden();

    expect(Quiz::where('user_id', $stranger->id)->count())->toBe(0);
});

test('the owner can still copy their own quiz even when allow_copying is false', function () {
    $owner = User::factory()->create();
    $quiz = quizWithOneQuestion($owner, ['allow_copying' => false]);

    $this->actingAs($owner)->post("/quizzes/{$quiz->id}/copy")->assertRedirect();

    expect(Quiz::where('user_id', $owner->id)->where('copied_from_quiz_id', $quiz->id)->exists())->toBeTrue();
});

test('copy lineage relations resolve in both directions', function () {
    $owner = User::factory()->create();
    $copier = User::factory()->create();
    $original = quizWithOneQuestion($owner, ['allow_copying' => true]);

    $this->actingAs($copier)->post("/quizzes/{$original->id}/copy");
    $copy = Quiz::where('user_id', $copier->id)->first();

    expect($copy->copiedFrom->id)->toBe($original->id);
    expect($original->fresh()->copies->pluck('id')->all())->toBe([$copy->id]);
});

test('the quiz language can be changed independently after copying', function () {
    $owner = User::factory()->create();
    $copier = User::factory()->create();
    $original = quizWithOneQuestion($owner, ['allow_copying' => true, 'language' => 'en']);

    $this->actingAs($copier)->post("/quizzes/{$original->id}/copy");
    $copy = Quiz::where('user_id', $copier->id)->first();

    $this->actingAs($copier)->put("/quizzes/{$copy->id}", [
        'title' => $copy->title,
        'language' => 'fr',
        'allow_copying' => true,
        'tag_ids' => [],
        'questions' => $copy->questions->map(fn ($q) => [
            'text' => $q->text,
            'answers' => $q->answers->map(fn ($a) => [
                'text' => $a->text,
                'is_correct' => $a->is_correct,
            ])->all(),
        ])->all(),
    ]);

    expect($copy->fresh()->language)->toBe('fr');
    expect($original->fresh()->language)->toBe('en');
});
