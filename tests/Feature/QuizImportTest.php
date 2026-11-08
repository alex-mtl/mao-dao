<?php

use App\Models\Quiz;
use App\Models\Tag;
use App\Models\User;

beforeEach(function () {
    $this->owner = User::factory()->create();
    config(['quiz.import_secret' => 's3cret', 'quiz.import_user_id' => $this->owner->id]);
    Tag::factory()->create(['name' => 'Geography', 'slug' => 'geography']);
});

function importQuestion(string $text, string $correct = 'Канберра'): array
{
    return ['text' => $text, 'answers' => [
        ['text' => $correct, 'is_correct' => true],
        ['text' => 'Сидней', 'is_correct' => false],
        ['text' => 'Мельбурн', 'is_correct' => false],
        ['text' => 'Перт', 'is_correct' => false],
    ]];
}

function importBody(array $questions): array
{
    return ['key' => 'geo-capitals-1', 'title' => 'Столицы мира', 'language' => 'ru', 'tags' => ['geography'], 'questions' => $questions];
}

it('refuses calls without the secret', function () {
    $this->postJson('/internal/quizzes/import', importBody([importQuestion('Столица Австралии?')]))->assertForbidden();
    $this->postJson('/internal/quizzes/import', importBody([importQuestion('Столица Австралии?')]), ['X-Internal-Secret' => 'no'])->assertForbidden();
    expect(Quiz::count())->toBe(0);
});

it('creates a published quiz with tags, then only adds new questions on a re-run', function () {
    $h = ['X-Internal-Secret' => 's3cret'];
    $this->postJson('/internal/quizzes/import', importBody([importQuestion('Столица Австралии?')]), $h)
        ->assertOk()->assertJson(['added' => 1, 'skipped' => 0, 'total' => 1]);

    $this->postJson('/internal/quizzes/import', importBody([importQuestion('Столица Австралии?'), importQuestion('Столица Перу?', 'Лима')]), $h)
        ->assertOk()->assertJson(['added' => 1, 'skipped' => 1, 'total' => 2]);

    $quiz = Quiz::with('questions.answers', 'tags')->sole();
    expect($quiz->user_id)->toBe($this->owner->id)
        ->and($quiz->status)->toBe('published')
        ->and($quiz->import_key)->toBe('geo-capitals-1')
        ->and($quiz->tags->pluck('slug')->all())->toBe(['geography'])
        ->and($quiz->questions->pluck('text')->all())->toBe(['Столица Австралии?', 'Столица Перу?'])
        ->and($quiz->questions[1]->correctAnswer()->text)->toBe('Лима');
});

it('keeps the whole pool of wrong answers and refreshes it on a re-run', function () {
    $h = ['X-Internal-Secret' => 's3cret'];
    $q = [...importQuestion('Столица Австралии?'), 'wrong_pool' => ['Сидней', 'Мельбурн', 'Перт', 'Веллингтон']];
    $this->postJson('/internal/quizzes/import', importBody([$q]), $h)->assertOk()->assertJson(['added' => 1]);
    expect(Quiz::sole()->questions->sole()->wrong_pool)->toBe(['Сидней', 'Мельбурн', 'Перт', 'Веллингтон']);

    $q['wrong_pool'][] = 'Аделаида';
    $this->postJson('/internal/quizzes/import', importBody([$q]), $h)->assertOk()->assertJson(['added' => 0, 'updated' => 1, 'skipped' => 0]);
    $question = Quiz::sole()->questions->sole();
    expect($question->wrong_pool)->toHaveCount(5)->and($question->answers)->toHaveCount(4);

    $bad = [...importQuestion('Столица Перу?', 'Лима'), 'wrong_pool' => ['Куско', 'лима']];
    $this->postJson('/internal/quizzes/import', importBody([$bad]), $h)->assertUnprocessable();
});

it('rewords a question found by its key or its previous text, keeping its answers', function () {
    $h = ['X-Internal-Secret' => 's3cret'];
    $this->postJson('/internal/quizzes/import', importBody([importQuestion('Какой город — столица Австралии?')]), $h)->assertOk();
    $answerIds = Quiz::sole()->questions->sole()->answers->pluck('id')->all();

    // an old question without a key: found by the text it had
    $q = [...importQuestion('Столица Австралии?'), 'key' => 'capital:Q408', 'previous_text' => 'Какой город — столица Австралии?'];
    $this->postJson('/internal/quizzes/import', importBody([$q]), $h)->assertOk()->assertJson(['added' => 0, 'updated' => 1]);
    // from now on by its key
    $q['text'] = 'Столица Австралии? (2)';
    unset($q['previous_text']);
    $this->postJson('/internal/quizzes/import', importBody([$q]), $h)->assertOk()->assertJson(['added' => 0, 'updated' => 1]);
    $this->postJson('/internal/quizzes/import', importBody([$q]), $h)->assertOk()->assertJson(['added' => 0, 'updated' => 0, 'skipped' => 1]);

    $question = Quiz::sole()->questions->sole();
    expect($question->text)->toBe('Столица Австралии? (2)')
        ->and($question->import_key)->toBe('capital:Q408')
        ->and($question->answers->pluck('id')->all())->toBe($answerIds);
});

it('rejects questions without exactly one correct of four different answers', function () {
    $h = ['X-Internal-Secret' => 's3cret'];
    $bad = importQuestion('Столица Австралии?');
    $bad['answers'][1]['is_correct'] = true;
    $this->postJson('/internal/quizzes/import', importBody([$bad]), $h)->assertUnprocessable();

    $dup = importQuestion('Столица Австралии?');
    $dup['answers'][3]['text'] = 'сидней';
    $this->postJson('/internal/quizzes/import', importBody([$dup]), $h)->assertUnprocessable();

    $three = importQuestion('Столица Австралии?');
    array_pop($three['answers']);
    $this->postJson('/internal/quizzes/import', importBody([$three]), $h)->assertUnprocessable();

    $this->postJson('/internal/quizzes/import', [...importBody([importQuestion('Столица Австралии?')]), 'tags' => ['nope']], $h)->assertUnprocessable();
    expect(Quiz::count())->toBe(0);
});
