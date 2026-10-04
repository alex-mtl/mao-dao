<?php

namespace App\Http\Controllers;

use App\Models\Quiz;
use App\Models\QuizAttempt;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class QuizAttemptController extends Controller
{
    public function play(Request $request, Quiz $quiz): Response
    {
        abort_unless($quiz->isPublished(), 404);

        $quiz->load(['questions.answers']);

        // The server is the sole authority on how long an attempt takes:
        // record the start time in the session now, and diff against it
        // in store() — never trust a client-reported duration.
        $request->session()->put("quiz_attempt_started.{$quiz->id}", now());

        return Inertia::render('Quizzes/Play', [
            'quiz' => [
                'id' => $quiz->id,
                'title' => $quiz->title,
                'estimated_minutes' => $quiz->estimated_minutes,
                // Correct-answer flags are deliberately omitted here — the
                // player must never receive them before submitting.
                // Questions and answers are shuffled server-side on every
                // visit so repeated plays don't memorize by position.
                'questions' => $quiz->questions->shuffle()->values()->map(fn ($question) => [
                    'id' => $question->id,
                    'text' => $question->text,
                    'answers' => $question->answers->shuffle()->values()->map(fn ($answer) => [
                        'id' => $answer->id,
                        'text' => $answer->text,
                    ]),
                ]),
            ],
        ]);
    }

    public function store(Request $request, Quiz $quiz): RedirectResponse
    {
        abort_unless($quiz->isPublished(), 404);

        $quiz->load(['questions.answers']);

        $validQuestionIds = $quiz->questions->pluck('id');

        $validated = $request->validate([
            'answers' => ['required', 'array'],
            'answers.*.question_id' => [
                'required', 'integer', Rule::in($validQuestionIds),
            ],
            'answers.*.answer_id' => ['required', 'integer'],
        ]);

        $startedAt = $request->session()->pull("quiz_attempt_started.{$quiz->id}");
        $timeSpentSeconds = $startedAt
            ? (int) round(now()->diffInSeconds($startedAt, absolute: true))
            : null;

        $attempt = DB::transaction(function () use ($request, $quiz, $validated, $timeSpentSeconds) {
            $correctCount = 0;
            $answerRows = [];

            foreach ($quiz->questions as $question) {
                $submitted = collect($validated['answers'])
                    ->firstWhere('question_id', $question->id);

                $chosenAnswer = $submitted
                    ? $question->answers->firstWhere('id', $submitted['answer_id'])
                    : null;

                $isCorrect = (bool) $chosenAnswer?->is_correct;

                if ($isCorrect) {
                    $correctCount++;
                }

                $answerRows[] = [
                    'question_id' => $question->id,
                    'answer_id' => $chosenAnswer?->id,
                    'is_correct' => $isCorrect,
                ];
            }

            $total = $quiz->questions->count();
            $percentage = $total > 0 ? (int) round(($correctCount / $total) * 100) : 0;

            $attempt = QuizAttempt::create([
                'quiz_id' => $quiz->id,
                'user_id' => $request->user()->id,
                'total_questions' => $total,
                'correct_count' => $correctCount,
                'percentage' => $percentage,
                'time_spent_seconds' => $timeSpentSeconds,
                'passed' => $percentage >= config('quiz.passing_threshold_percent'),
            ]);

            $attempt->answers()->createMany($answerRows);

            return $attempt;
        });

        return redirect()->route('quiz-attempts.show', $attempt);
    }

    public function show(Request $request, QuizAttempt $quizAttempt): Response
    {
        $this->authorize('view', $quizAttempt);

        $quizAttempt->load(['quiz:id,title', 'answers.question.answers', 'answers.answer']);

        return Inertia::render('Quizzes/Results', [
            'attempt' => [
                'id' => $quizAttempt->id,
                'quiz_title' => $quizAttempt->quiz->title,
                'quiz_id' => $quizAttempt->quiz_id,
                'total_questions' => $quizAttempt->total_questions,
                'correct_count' => $quizAttempt->correct_count,
                'percentage' => $quizAttempt->percentage,
                'time_spent_seconds' => $quizAttempt->time_spent_seconds,
                'passed' => $quizAttempt->passed,
                'answers' => $quizAttempt->answers->map(fn ($answerRow) => [
                    'question_text' => $answerRow->question->text,
                    'chosen_answer_text' => $answerRow->answer?->text,
                    'correct_answer_text' => $answerRow->question->answers->firstWhere('is_correct', true)?->text,
                    'is_correct' => $answerRow->is_correct,
                ]),
            ],
            'similar_quizzes' => $this->similarQuizzes($quizAttempt->quiz_id),
        ]);
    }

    /**
     * Up to 4 other published quizzes sharing at least one tag with the
     * given one, most shared tags first, then newest.
     */
    private function similarQuizzes(int $quizId)
    {
        $tagIds = Quiz::findOrFail($quizId)->tags()->pluck('tags.id');

        if ($tagIds->isEmpty()) {
            return [];
        }

        return Quiz::query()
            ->published()
            ->where('id', '!=', $quizId)
            ->whereHas('tags', fn ($q) => $q->whereIn('tags.id', $tagIds))
            ->withCount([
                'questions',
                'tags as shared_tags_count' => fn ($q) => $q->whereIn('tags.id', $tagIds),
            ])
            ->with(['user:id,name', 'tags:id,name'])
            ->orderByDesc('shared_tags_count')
            ->orderByDesc('published_at')
            ->limit(4)
            ->get();
    }

    public function history(Request $request): Response
    {
        $attempts = $request->user()->quizAttempts()
            ->with('quiz:id,title')
            ->orderByDesc('created_at')
            ->paginate(15);

        return Inertia::render('Quizzes/History', [
            'attempts' => $attempts,
        ]);
    }
}
