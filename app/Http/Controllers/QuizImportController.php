<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Quiz;
use App\Models\Tag;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Generated questions into the quiz library (services/quiz-factory, README there).
 * POST /internal/quizzes/import, header X-Internal-Secret = QUIZ_IMPORT_SECRET:
 * {key, title, description?, language, tags: [slug], status?: published|draft,
 *  questions: [{text, answers: [{text, is_correct} x4], wrong_pool?: [every generated wrong answer],
 *               key?: the factory's id ("capital:Q33"), previous_text?: its wording before a rewording}]}
 * The quiz is found by its key (quizzes.import_key) or made for the user QUIZ_IMPORT_USER_ID. A question the
 * quiz already has (same key, same text or previous_text) keeps its answers - attempts point at them - and only
 * gets the new wording, key and pool of wrong answers; others are added. Nothing is deleted, a re-run is safe.
 */
class QuizImportController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $secret = (string) config('quiz.import_secret');
        abort_unless($secret !== '' && hash_equals($secret, (string) $request->header('X-Internal-Secret')), 403);
        $owner = User::find(config('quiz.import_user_id'));
        abort_unless($owner !== null, 503, 'QUIZ_IMPORT_USER_ID is not a user');

        $data = $request->validate([
            'key' => ['required', 'string', 'max:100', 'regex:/^[a-z0-9][a-z0-9._-]*$/'],
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],
            'language' => ['required', Rule::in(config('locales.supported'))],
            'tags' => ['array'],
            'tags.*' => ['string', Rule::exists('tags', 'slug')],
            'status' => ['nullable', Rule::in(['published', 'draft'])],
            'questions' => ['required', 'array', 'min:1', 'max:500'],
            'questions.*.text' => ['required', 'string', 'max:150'],
            'questions.*.answers' => ['required', 'array', 'size:4'],
            'questions.*.answers.*.text' => ['required', 'string', 'max:32'],
            'questions.*.answers.*.is_correct' => ['required', 'boolean'],
            'questions.*.wrong_pool' => ['nullable', 'array', 'max:50'],
            'questions.*.wrong_pool.*' => ['required', 'string', 'max:32'],
            'questions.*.key' => ['nullable', 'string', 'max:100'],
            'questions.*.previous_text' => ['nullable', 'string', 'max:150'],
        ]);

        foreach ($data['questions'] as $i => $question) {
            $texts = array_map(fn ($a) => mb_strtolower(trim($a['text'])), $question['answers']);
            $correct = collect($question['answers'])->where('is_correct', true);
            if ($correct->count() !== 1 || count(array_unique($texts)) !== 4) {
                throw ValidationException::withMessages(["questions.$i" => 'exactly one correct answer and four different answers']);
            }
            $pool = array_map(fn ($t) => mb_strtolower(trim($t)), $question['wrong_pool'] ?? []);
            if (in_array(mb_strtolower(trim($correct->first()['text'])), $pool, true)) {
                throw ValidationException::withMessages(["questions.$i.wrong_pool" => 'the correct answer is in the pool of wrong ones']);
            }
        }

        return DB::transaction(function () use ($data, $owner) {
            $quiz = Quiz::where('import_key', $data['key'])->lockForUpdate()->first()
                ?? new Quiz(['import_key' => $data['key'], 'user_id' => $owner->id, 'allow_copying' => true]);
            $quiz->fill([
                'title' => $data['title'],
                'description' => $data['description'] ?? null,
                'language' => $data['language'],
            ]);
            $quiz->status ??= 'draft';
            $quiz->save();

            $existing = $quiz->questions()->get();
            $byKey = $existing->whereNotNull('import_key')->keyBy('import_key');
            $byText = $existing->keyBy(fn ($q) => mb_strtolower(trim($q->text)));
            $order = (int) $quiz->questions()->max('order');
            $added = $updated = 0;
            foreach ($data['questions'] as $q) {
                $norm = mb_strtolower(trim($q['text']));
                $key = $q['key'] ?? null;
                $pool = isset($q['wrong_pool']) ? array_values(array_unique(array_map('trim', $q['wrong_pool']))) : null;
                // the same question: by its key, or by its text (also the text it had before a rewording)
                $old = ($key !== null ? $byKey->get($key) : null) ?? $byText->get($norm)
                    ?? (isset($q['previous_text']) ? $byText->get(mb_strtolower(trim($q['previous_text']))) : null);
                if ($old !== null) {
                    // its answers stay (attempts point at them); wording, key and pool of wrong answers are refreshed
                    $old->fill(array_filter(['text' => trim($q['text']), 'import_key' => $key, 'wrong_pool' => $pool], fn ($v) => $v !== null));
                    if ($old->isDirty()) {
                        $old->save();
                        $updated++;
                    }

                    continue;
                }
                $question = $quiz->questions()->create(['text' => trim($q['text']), 'order' => ++$order, 'wrong_pool' => $pool, 'import_key' => $key]);
                $byText[$norm] = $question;
                if ($key !== null) {
                    $byKey[$key] = $question;
                }
                foreach (array_values($q['answers']) as $j => $a) {
                    $question->answers()->create(['text' => trim($a['text']), 'is_correct' => (bool) $a['is_correct'], 'order' => $j]);
                }
                $added++;
            }

            if (isset($data['tags'])) {
                $quiz->tags()->sync(Tag::whereIn('slug', $data['tags'])->pluck('id'));
            }
            $total = $quiz->questions()->count();
            $status = $data['status'] ?? 'published';
            $quiz->update([
                'estimated_minutes' => max(1, (int) ceil($total * 20 / 60)),
                'status' => $status,
                'published_at' => $status === 'published' ? ($quiz->published_at ?? now()) : $quiz->published_at,
            ]);

            return response()->json([
                'quiz_id' => $quiz->id,
                'url' => route('quizzes.show', $quiz),
                'added' => $added,
                'updated' => $updated,
                'skipped' => count($data['questions']) - $added - $updated,
                'total' => $total,
            ]);
        });
    }
}
