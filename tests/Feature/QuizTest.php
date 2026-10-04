<?php

use App\Models\Quiz;
use App\Models\Tag;
use App\Models\User;

function validQuestionPayload(string $text = 'What is 2+2?'): array
{
    return [
        'text' => $text,
        'answers' => [
            ['text' => '4', 'is_correct' => true],
            ['text' => '3', 'is_correct' => false],
            ['text' => '5', 'is_correct' => false],
            ['text' => '22', 'is_correct' => false],
        ],
    ];
}

test('a quiz can be saved as a draft with a valid question', function () {
    $user = User::factory()->create();
    $tag = Tag::factory()->create();

    $response = $this->actingAs($user)->post('/quizzes', [
        'title' => 'My Quiz',
        'language' => 'en',
        'allow_copying' => true,
        'tag_ids' => [$tag->id],
        'questions' => [validQuestionPayload()],
    ]);

    $quiz = Quiz::where('title', 'My Quiz')->first();
    $response->assertRedirect(route('quizzes.edit', $quiz));
    expect($quiz->status)->toBe('draft');
    expect($quiz->questions)->toHaveCount(1);
    expect($quiz->questions->first()->answers)->toHaveCount(4);
    expect($quiz->tags->pluck('id')->all())->toBe([$tag->id]);
});

test('a quiz stores the authors estimated time to complete', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->post('/quizzes', [
        'title' => 'Timed Quiz',
        'language' => 'en',
        'estimated_minutes' => 95,
        'questions' => [],
    ]);

    $quiz = Quiz::where('title', 'Timed Quiz')->first();
    $response->assertRedirect(route('quizzes.edit', $quiz));
    expect($quiz->estimated_minutes)->toBe(95);
});

test('estimated time is optional and can be cleared on update', function () {
    $user = User::factory()->create();
    $quiz = Quiz::factory()->create(['user_id' => $user->id, 'estimated_minutes' => 30]);

    $this->actingAs($user)->put("/quizzes/{$quiz->id}", [
        'title' => $quiz->title,
        'language' => $quiz->language,
        'estimated_minutes' => null,
        'questions' => [],
    ]);

    expect($quiz->fresh()->estimated_minutes)->toBeNull();
});

test('estimated time over the maximum is rejected', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->post('/quizzes', [
        'title' => 'Too Long',
        'language' => 'en',
        'estimated_minutes' => 6000,
        'questions' => [],
    ]);

    $response->assertSessionHasErrors('estimated_minutes');
});

test('a question must have exactly one correct answer', function () {
    $user = User::factory()->create();

    $badQuestion = validQuestionPayload();
    $badQuestion['answers'][0]['is_correct'] = false; // now zero correct answers

    $response = $this->actingAs($user)->post('/quizzes', [
        'title' => 'Bad Quiz',
        'language' => 'en',
        'allow_copying' => true,
        'tag_ids' => [],
        'questions' => [$badQuestion],
    ]);

    $response->assertSessionHasErrors('questions');
    $this->assertDatabaseMissing('quizzes', ['title' => 'Bad Quiz']);
});

test('a question requires exactly four answers', function () {
    $user = User::factory()->create();

    $badQuestion = validQuestionPayload();
    array_pop($badQuestion['answers']); // only 3 answers now

    $response = $this->actingAs($user)->post('/quizzes', [
        'title' => 'Bad Quiz',
        'language' => 'en',
        'allow_copying' => true,
        'tag_ids' => [],
        'questions' => [$badQuestion],
    ]);

    $response->assertSessionHasErrors();
});

test('question text over 150 characters is rejected', function () {
    $user = User::factory()->create();

    $badQuestion = validQuestionPayload(str_repeat('a', 151));

    $response = $this->actingAs($user)->post('/quizzes', [
        'title' => 'Bad Quiz',
        'language' => 'en',
        'allow_copying' => true,
        'tag_ids' => [],
        'questions' => [$badQuestion],
    ]);

    $response->assertSessionHasErrors();
});

test('answer text over 32 characters is rejected', function () {
    $user = User::factory()->create();

    $badQuestion = validQuestionPayload();
    $badQuestion['answers'][0]['text'] = str_repeat('a', 33);

    $response = $this->actingAs($user)->post('/quizzes', [
        'title' => 'Bad Quiz',
        'language' => 'en',
        'allow_copying' => true,
        'tag_ids' => [],
        'questions' => [$badQuestion],
    ]);

    $response->assertSessionHasErrors();
});

test('only the owner can update, publish, or delete a quiz', function () {
    $owner = User::factory()->create();
    $intruder = User::factory()->create();
    $quiz = Quiz::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($intruder)->put("/quizzes/{$quiz->id}", [
        'title' => 'Hijacked',
        'language' => 'en',
        'allow_copying' => true,
        'tag_ids' => [],
        'questions' => [],
    ])->assertForbidden();

    $this->actingAs($intruder)->post("/quizzes/{$quiz->id}/publish")->assertForbidden();
    $this->actingAs($intruder)->delete("/quizzes/{$quiz->id}")->assertForbidden();

    expect($quiz->fresh()->title)->not->toBe('Hijacked');
});

test('a quiz cannot be published without at least one valid question', function () {
    $user = User::factory()->create();
    $quiz = Quiz::factory()->create(['user_id' => $user->id]);

    $response = $this->actingAs($user)->post("/quizzes/{$quiz->id}/publish");

    $response->assertSessionHasErrors('questions');
    expect($quiz->fresh()->status)->toBe('draft');
});

test('a quiz with a fully valid question publishes successfully', function () {
    $user = User::factory()->create();
    $quiz = Quiz::factory()->create(['user_id' => $user->id]);
    $question = $quiz->questions()->create(['text' => 'Q?', 'order' => 0]);
    $question->answers()->create(['text' => 'A', 'is_correct' => true, 'order' => 0]);
    $question->answers()->create(['text' => 'B', 'is_correct' => false, 'order' => 1]);
    $question->answers()->create(['text' => 'C', 'is_correct' => false, 'order' => 2]);
    $question->answers()->create(['text' => 'D', 'is_correct' => false, 'order' => 3]);

    $this->actingAs($user)->post("/quizzes/{$quiz->id}/publish")->assertRedirect();

    expect($quiz->fresh()->status)->toBe('published');
    expect($quiz->fresh()->published_at)->not->toBeNull();
});

test('a draft quiz is not visible to other users via the library', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $quiz = Quiz::factory()->create(['user_id' => $owner->id, 'status' => 'draft']);

    $this->actingAs($other)->get("/quizzes/{$quiz->id}")->assertForbidden();
    $this->actingAs($owner)->get("/quizzes/{$quiz->id}")->assertOk();
});

test('deleting a quiz removes it and its questions', function () {
    $user = User::factory()->create();
    $quiz = Quiz::factory()->create(['user_id' => $user->id]);
    $question = $quiz->questions()->create(['text' => 'Q?', 'order' => 0]);

    $this->actingAs($user)->delete("/quizzes/{$quiz->id}")->assertRedirect();

    $this->assertDatabaseMissing('quizzes', ['id' => $quiz->id]);
    $this->assertDatabaseMissing('questions', ['id' => $question->id]);
});
