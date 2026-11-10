<?php

use App\Models\Answer;
use App\Models\Question;
use App\Models\Quiz;
use App\Models\Tag;

beforeEach(fn () => config(['guessword.engine_secret' => 's3cret']));

function bankQuiz(string $key, string $tag, array $attrs = []): Quiz
{
    $quiz = Quiz::factory()->create(array_merge(['import_key' => $key, 'language' => 'ru', 'status' => 'published', 'title' => 'География: лёгкий уровень — №1'], $attrs));
    $quiz->tags()->attach(Tag::firstOrCreate(['slug' => $tag], ['name' => ucfirst($tag)])->id);
    $q = Question::create(['quiz_id' => $quiz->id, 'text' => 'Столица Австралии?', 'order' => 1, 'wrong_pool' => ['Сидней', 'Мельбурн', 'Перт'], 'import_key' => 'capital:Q408']);
    foreach (['Канберра', 'Сидней', 'Мельбурн', 'Перт'] as $i => $t) {
        Answer::create(['question_id' => $q->id, 'text' => $t, 'is_correct' => $i === 0, 'order' => $i]);
    }

    return $quiz;
}

it('gives the engine the generated quizzes with every wrong answer', function () {
    bankQuiz('geo-easy-1', 'geography');
    bankQuiz('geo-hard-2', 'geography', ['status' => 'draft']);              // not published: not played
    Quiz::factory()->create(['language' => 'ru', 'status' => 'published']);  // a member's own quiz: not played

    $this->getJson('/internal/guessword/quizzes?lang=ru')->assertForbidden();
    $this->getJson('/internal/guessword/quizzes?lang=ru', ['X-Internal-Secret' => 's3cret'])->assertOk()
        ->assertJsonCount(1, 'quizzes')
        ->assertJsonPath('quizzes.0.topic', 'geography')
        ->assertJsonPath('quizzes.0.level', 'easy')
        ->assertJsonPath('quizzes.0.questions.0.type', 'capital')
        ->assertJsonPath('quizzes.0.questions.0.correct', 'Канберра')
        ->assertJsonPath('quizzes.0.questions.0.wrong', ['Сидней', 'Мельбурн', 'Перт']);
    $this->getJson('/internal/guessword/quizzes?lang=en', ['X-Internal-Secret' => 's3cret'])->assertOk()->assertJsonCount(0, 'quizzes');
});
