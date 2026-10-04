<?php

namespace App\Http\Controllers;

use App\Models\Quiz;
use App\Models\Tag;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redirect;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class QuizController extends Controller
{
    public function mine(Request $request): Response
    {
        $quizzes = $request->user()->quizzes()
            ->withCount('questions')
            ->orderByDesc('updated_at')
            ->get();

        return Inertia::render('Quizzes/Mine', [
            'quizzes' => $quizzes,
        ]);
    }

    public function create(Request $request): Response
    {
        return Inertia::render('Quizzes/Editor', [
            'quiz' => null,
            'tags' => Tag::orderBy('name')->get(['id', 'name']),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $this->validateQuiz($request);

        $quiz = DB::transaction(function () use ($request, $validated) {
            $quiz = Quiz::create([
                'user_id' => $request->user()->id,
                'title' => $validated['title'],
                'description' => $validated['description'] ?? null,
                'language' => $validated['language'],
                'allow_copying' => $validated['allow_copying'] ?? true,
                'estimated_minutes' => $validated['estimated_minutes'] ?? null,
                'status' => 'draft',
            ]);

            $quiz->tags()->sync($validated['tag_ids'] ?? []);
            $this->replaceQuestions($quiz, $validated['questions'] ?? []);

            return $quiz;
        });

        return Redirect::route('quizzes.edit', $quiz);
    }

    public function edit(Request $request, Quiz $quiz): Response
    {
        $this->authorize('update', $quiz);

        $quiz->load(['questions.answers', 'tags:id']);

        return Inertia::render('Quizzes/Editor', [
            'quiz' => $this->formatQuiz($quiz),
            'tags' => Tag::orderBy('name')->get(['id', 'name']),
        ]);
    }

    public function update(Request $request, Quiz $quiz): RedirectResponse
    {
        $this->authorize('update', $quiz);

        $validated = $this->validateQuiz($request);

        DB::transaction(function () use ($quiz, $validated) {
            $quiz->update([
                'title' => $validated['title'],
                'description' => $validated['description'] ?? null,
                'language' => $validated['language'],
                'allow_copying' => $validated['allow_copying'] ?? true,
                'estimated_minutes' => $validated['estimated_minutes'] ?? null,
            ]);

            $quiz->tags()->sync($validated['tag_ids'] ?? []);
            $this->replaceQuestions($quiz, $validated['questions'] ?? []);
        });

        return Redirect::route('quizzes.edit', $quiz);
    }

    public function publish(Request $request, Quiz $quiz): RedirectResponse
    {
        $this->authorize('publish', $quiz);

        $quiz->loadMissing('questions.answers');

        if ($quiz->questions->isEmpty()) {
            throw ValidationException::withMessages([
                'questions' => __('quiz_editor.publish_requires_question'),
            ]);
        }

        foreach ($quiz->questions as $question) {
            if ($question->answers->count() !== 4 || $question->answers->where('is_correct', true)->count() !== 1) {
                throw ValidationException::withMessages([
                    'questions' => __('quiz_editor.publish_requires_valid_questions'),
                ]);
            }
        }

        $quiz->update([
            'status' => 'published',
            'published_at' => $quiz->published_at ?? now(),
        ]);

        return Redirect::route('quizzes.edit', $quiz);
    }

    public function preview(Request $request, Quiz $quiz): Response
    {
        $this->authorize('update', $quiz);

        $quiz->load(['questions.answers']);

        return Inertia::render('Quizzes/Preview', [
            'quiz' => $this->formatQuiz($quiz),
        ]);
    }

    /**
     * Deep-clone the quiz (and its questions/answers) into a brand-new,
     * independently-owned draft. Tags are re-pivoted rather than cloned
     * since they're shared reference data, not part of the quiz's mutable
     * content. Attempts/likes are never copied — they're participant
     * history, not quiz definition.
     */
    public function copy(Request $request, Quiz $quiz): RedirectResponse
    {
        $this->authorize('copy', $quiz);

        $quiz->load(['questions.answers', 'tags:id']);

        $copy = DB::transaction(function () use ($request, $quiz) {
            $copy = Quiz::create([
                'user_id' => $request->user()->id,
                'title' => $quiz->title,
                'description' => $quiz->description,
                'language' => $quiz->language,
                'status' => 'draft',
                'allow_copying' => true,
                'estimated_minutes' => $quiz->estimated_minutes,
                'copied_from_quiz_id' => $quiz->id,
            ]);

            $copy->tags()->sync($quiz->tags->pluck('id'));

            foreach ($quiz->questions as $question) {
                $newQuestion = $copy->questions()->create([
                    'text' => $question->text,
                    'order' => $question->order,
                ]);

                foreach ($question->answers as $answer) {
                    $newQuestion->answers()->create([
                        'text' => $answer->text,
                        'is_correct' => $answer->is_correct,
                        'order' => $answer->order,
                    ]);
                }
            }

            return $copy;
        });

        return Redirect::route('quizzes.edit', $copy);
    }

    public function destroy(Request $request, Quiz $quiz): RedirectResponse
    {
        $this->authorize('delete', $quiz);

        $quiz->delete();

        return Redirect::route('quizzes.mine');
    }

    /**
     * @return array<string, mixed>
     */
    private function validateQuiz(Request $request): array
    {
        return $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'language' => ['required', Rule::in(config('locales.supported'))],
            'allow_copying' => ['boolean'],
            'estimated_minutes' => ['nullable', 'integer', 'min:1', 'max:5999'],
            'tag_ids' => ['array'],
            'tag_ids.*' => ['integer', Rule::exists('tags', 'id')],
            'questions' => ['array'],
            'questions.*.text' => ['required', 'string', 'max:150'],
            'questions.*.answers' => ['array', 'size:4'],
            'questions.*.answers.*.text' => ['required', 'string', 'max:32'],
            'questions.*.answers.*.is_correct' => ['boolean'],
        ], [], []);
    }

    /**
     * @param  array<int, array{text: string, answers: array<int, array{text: string, is_correct: bool}>}>  $questions
     */
    private function replaceQuestions(Quiz $quiz, array $questions): void
    {
        foreach ($questions as $questionData) {
            $correctCount = collect($questionData['answers'])->where('is_correct', true)->count();

            if ($correctCount !== 1) {
                throw ValidationException::withMessages([
                    'questions' => __('quiz_editor.exactly_one_correct_answer'),
                ]);
            }
        }

        $quiz->questions()->delete();

        foreach (array_values($questions) as $questionIndex => $questionData) {
            $question = $quiz->questions()->create([
                'text' => $questionData['text'],
                'order' => $questionIndex,
            ]);

            foreach (array_values($questionData['answers']) as $answerIndex => $answerData) {
                $question->answers()->create([
                    'text' => $answerData['text'],
                    'is_correct' => (bool) ($answerData['is_correct'] ?? false),
                    'order' => $answerIndex,
                ]);
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function formatQuiz(Quiz $quiz): array
    {
        return [
            'id' => $quiz->id,
            'title' => $quiz->title,
            'description' => $quiz->description,
            'language' => $quiz->language,
            'status' => $quiz->status,
            'allow_copying' => $quiz->allow_copying,
            'estimated_minutes' => $quiz->estimated_minutes,
            'tag_ids' => $quiz->tags->pluck('id'),
            'questions' => $quiz->questions->map(fn ($question) => [
                'text' => $question->text,
                'answers' => $question->answers->map(fn ($answer) => [
                    'text' => $answer->text,
                    'is_correct' => $answer->is_correct,
                ]),
            ]),
        ];
    }
}
