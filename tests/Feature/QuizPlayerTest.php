<?php

use App\Models\Answer;
use App\Models\Question;
use App\Models\Quiz;
use App\Models\QuizAttempt;
use App\Models\User;

function publishedQuizWithTwoQuestions(User $owner): Quiz
{
    $quiz = Quiz::factory()->published()->create(['user_id' => $owner->id]);

    foreach (range(1, 2) as $i) {
        $question = Question::factory()->create(['quiz_id' => $quiz->id, 'order' => $i]);
        Answer::factory()->create(['question_id' => $question->id, 'text' => 'Right', 'is_correct' => true, 'order' => 0]);
        Answer::factory()->create(['question_id' => $question->id, 'text' => 'Wrong 1', 'is_correct' => false, 'order' => 1]);
        Answer::factory()->create(['question_id' => $question->id, 'text' => 'Wrong 2', 'is_correct' => false, 'order' => 2]);
        Answer::factory()->create(['question_id' => $question->id, 'text' => 'Wrong 3', 'is_correct' => false, 'order' => 3]);
    }

    return $quiz->fresh(['questions.answers']);
}

test('the play page never exposes which answer is correct', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);

    $response = $this->actingAs($player)->get("/quizzes/{$quiz->id}/play");

    $response->assertInertia(function ($page) {
        $questions = $page->toArray()['props']['quiz']['questions'];
        foreach ($questions as $question) {
            foreach ($question['answers'] as $answer) {
                expect($answer)->not->toHaveKey('is_correct');
            }
        }
    });
});

test('questions and answers are shuffled but every id is still present', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);

    $response = $this->actingAs($player)->get("/quizzes/{$quiz->id}/play");

    $response->assertInertia(function ($page) use ($quiz) {
        $renderedQuestions = collect($page->toArray()['props']['quiz']['questions']);

        expect($renderedQuestions->pluck('id')->sort()->values()->all())
            ->toBe($quiz->questions->pluck('id')->sort()->values()->all());

        foreach ($quiz->questions as $question) {
            $renderedAnswers = collect(
                $renderedQuestions->firstWhere('id', $question->id)['answers'],
            );

            expect($renderedAnswers->pluck('id')->sort()->values()->all())
                ->toBe($question->answers->pluck('id')->sort()->values()->all());
        }
    });
});

test('a draft quiz cannot be played', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = Quiz::factory()->create(['user_id' => $owner->id, 'status' => 'draft']);

    $this->actingAs($player)->get("/quizzes/{$quiz->id}/play")->assertNotFound();
});

test('the server computes the score authoritatively, ignoring client input', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $questions = $quiz->questions;

    $correctAnswer = fn ($q) => $q->answers->firstWhere('is_correct', true);
    $wrongAnswer = fn ($q) => $q->answers->firstWhere('is_correct', false);

    // Answer question 1 correctly, question 2 incorrectly.
    $response = $this->actingAs($player)->post("/quizzes/{$quiz->id}/attempts", [
        'answers' => [
            ['question_id' => $questions[0]->id, 'answer_id' => $correctAnswer($questions[0])->id],
            ['question_id' => $questions[1]->id, 'answer_id' => $wrongAnswer($questions[1])->id],
        ],
    ]);

    $attempt = QuizAttempt::where('user_id', $player->id)->first();
    $response->assertRedirect(route('quiz-attempts.show', $attempt));
    expect($attempt->correct_count)->toBe(1);
    expect($attempt->total_questions)->toBe(2);
    expect($attempt->percentage)->toBe(50);
});

test('an attempt with all correct answers passes and one with none fails', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $questions = $quiz->questions;

    $this->actingAs($player)->post("/quizzes/{$quiz->id}/attempts", [
        'answers' => $questions->map(fn ($q) => [
            'question_id' => $q->id,
            'answer_id' => $q->answers->firstWhere('is_correct', true)->id,
        ])->all(),
    ]);

    $attempt = QuizAttempt::where('user_id', $player->id)->first();
    expect($attempt->passed)->toBeTrue();
    expect($attempt->percentage)->toBe(100);
});

test('submitting an answer_id belonging to a different question is scored as incorrect, not a crash', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $questions = $quiz->questions;

    // Tamper: for BOTH questions, submit an answer_id taken from the
    // *other* question — neither submission can legitimately match.
    $response = $this->actingAs($player)->post("/quizzes/{$quiz->id}/attempts", [
        'answers' => [
            ['question_id' => $questions[0]->id, 'answer_id' => $questions[1]->answers->first()->id],
            ['question_id' => $questions[1]->id, 'answer_id' => $questions[0]->answers->first()->id],
        ],
    ]);

    $response->assertRedirect();
    $attempt = QuizAttempt::where('user_id', $player->id)->first();
    expect($attempt->correct_count)->toBe(0);
});

test('the real time spent is measured server-side from play to submit', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $questions = $quiz->questions;

    $this->actingAs($player)->get("/quizzes/{$quiz->id}/play");

    $this->travel(90)->seconds();

    $this->actingAs($player)->post("/quizzes/{$quiz->id}/attempts", [
        'answers' => $questions->map(fn ($q) => [
            'question_id' => $q->id,
            'answer_id' => $q->answers->first()->id,
        ])->all(),
    ]);

    $attempt = QuizAttempt::where('user_id', $player->id)->first();
    expect($attempt->time_spent_seconds)->toBeGreaterThanOrEqual(89);
    expect($attempt->time_spent_seconds)->toBeLessThanOrEqual(91);
});

test('submitting an attempt without visiting the play page first stores no time', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $questions = $quiz->questions;

    $this->actingAs($player)->post("/quizzes/{$quiz->id}/attempts", [
        'answers' => $questions->map(fn ($q) => [
            'question_id' => $q->id,
            'answer_id' => $q->answers->first()->id,
        ])->all(),
    ]);

    $attempt = QuizAttempt::where('user_id', $player->id)->first();
    expect($attempt->time_spent_seconds)->toBeNull();
});

test('each attempt updates the quiz public average score and time stats', function () {
    $owner = User::factory()->create();
    $playerOne = User::factory()->create();
    $playerTwo = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $questions = $quiz->questions;

    $allCorrect = $questions->map(fn ($q) => [
        'question_id' => $q->id,
        'answer_id' => $q->answers->firstWhere('is_correct', true)->id,
    ])->all();
    $allWrong = $questions->map(fn ($q) => [
        'question_id' => $q->id,
        'answer_id' => $q->answers->firstWhere('is_correct', false)->id,
    ])->all();

    $this->actingAs($playerOne)->get("/quizzes/{$quiz->id}/play");
    $this->travel(60)->seconds();
    $this->actingAs($playerOne)->post("/quizzes/{$quiz->id}/attempts", ['answers' => $allCorrect]);

    $this->actingAs($playerTwo)->get("/quizzes/{$quiz->id}/play");
    $this->travel(120)->seconds();
    $this->actingAs($playerTwo)->post("/quizzes/{$quiz->id}/attempts", ['answers' => $allWrong]);

    $response = $this->actingAs($owner)->get("/quizzes/{$quiz->id}");

    $response->assertInertia(fn ($page) => $page
        ->where('quiz.attempts_count', 2)
        ->where('quiz.average_percentage', 50)
        ->where('quiz.average_time_spent_minutes', 2));
});

test('only the attempt owner can view its results', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $stranger = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);

    $attempt = QuizAttempt::create([
        'quiz_id' => $quiz->id,
        'user_id' => $player->id,
        'total_questions' => 2,
        'correct_count' => 2,
        'percentage' => 100,
        'passed' => true,
    ]);

    $this->actingAs($stranger)->get("/quiz-attempts/{$attempt->id}")->assertForbidden();
    $this->actingAs($player)->get("/quiz-attempts/{$attempt->id}")->assertOk();
});

test('the results page reveals the correct answer text for each question', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);

    $answers = $quiz->questions->map(fn ($q) => [
        'question_id' => $q->id,
        'answer_id' => $q->answers->firstWhere('text', 'Wrong 1')->id,
    ])->all();
    $this->actingAs($player)->post("/quizzes/{$quiz->id}/attempts", ['answers' => $answers]);
    $attempt = QuizAttempt::firstOrFail();

    $props = $this->actingAs($player)->get("/quiz-attempts/{$attempt->id}")->assertOk()->viewData('page')['props'];

    expect(collect($props['attempt']['answers'])->pluck('correct_answer_text')->unique()->all())->toBe(['Right']);
    expect(collect($props['attempt']['answers'])->pluck('chosen_answer_text')->unique()->all())->toBe(['Wrong 1']);
});

test('the results page lists up to 4 similar published quizzes, ranked by shared tags, excluding the current one', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    [$a, $b, $c] = \App\Models\Tag::factory()->count(3)->create();
    $quiz->tags()->attach([$a->id, $b->id]);

    $both = Quiz::factory()->published()->create(['title' => 'Shares two']);
    $both->tags()->attach([$a->id, $b->id]);
    $one = Quiz::factory()->published()->create(['title' => 'Shares one']);
    $one->tags()->attach([$a->id]);
    $unrelated = Quiz::factory()->published()->create(['title' => 'Unrelated']);
    $unrelated->tags()->attach([$c->id]);
    $draft = Quiz::factory()->create(['title' => 'Draft twin']);
    $draft->tags()->attach([$a->id, $b->id]);

    $attempt = QuizAttempt::create(['quiz_id' => $quiz->id, 'user_id' => $player->id, 'total_questions' => 2, 'correct_count' => 1, 'percentage' => 50, 'time_spent_seconds' => 45, 'passed' => false]);

    $props = $this->actingAs($player)->get("/quiz-attempts/{$attempt->id}")->assertOk()->viewData('page')['props'];

    expect(collect($props['similar_quizzes'])->pluck('title')->all())->toBe(['Shares two', 'Shares one']);
});

test('a quiz without tags has no similar quizzes', function () {
    $owner = User::factory()->create();
    $player = User::factory()->create();
    $quiz = publishedQuizWithTwoQuestions($owner);
    $attempt = QuizAttempt::create(['quiz_id' => $quiz->id, 'user_id' => $player->id, 'total_questions' => 2, 'correct_count' => 1, 'percentage' => 50, 'time_spent_seconds' => 45, 'passed' => false]);

    $props = $this->actingAs($player)->get("/quiz-attempts/{$attempt->id}")->viewData('page')['props'];

    expect($props['similar_quizzes'])->toBe([]);
});
