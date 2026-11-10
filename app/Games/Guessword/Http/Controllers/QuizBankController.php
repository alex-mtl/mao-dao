<?php

declare(strict_types=1);

namespace App\Games\Guessword\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\Quiz;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The quiz questions for the stream engine's "Quiz" game (stream-engine/app/games/quiz/).
 * GET /internal/guessword/quizzes?lang=ru, header X-Internal-Secret = the engine's secret ->
 * {quizzes: [{id, key, title, topic, level, questions: [{id, type, text, correct, wrong: [...]}]}]}
 * Only the generated quizzes (services/quiz-factory: import_key "<topic>-<level>-<n>", one tag = the topic):
 * every question there has its pool of up to 14 wrong answers - on the stream all of them are the variants.
 */
class QuizBankController extends Controller
{
    private const LEVELS = ['easy', 'medium', 'hard'];

    public function index(Request $request): JsonResponse
    {
        $secret = (string) config('guessword.engine_secret');
        abort_unless($secret !== '' && hash_equals($secret, (string) $request->header('X-Internal-Secret')), 403);
        $lang = (string) $request->query('lang', 'ru');
        abort_unless(in_array($lang, config('locales.supported'), true), 422);

        $quizzes = Quiz::published()->whereNotNull('import_key')->where('language', $lang)
            ->with(['tags:id,slug', 'questions.answers'])->orderBy('id')->get()
            ->map(function (Quiz $quiz) {
                $level = collect(self::LEVELS)->first(fn ($l) => str_contains($quiz->import_key, '-'.$l.'-'));
                $questions = $quiz->questions->map(function ($q) {
                    $correct = $q->correctAnswer();
                    if ($correct === null) {
                        return null;
                    }
                    $wrong = $q->wrong_pool ?: $q->answers->where('is_correct', false)->pluck('text')->all();

                    // the factory's question key is "<type>:<Wikidata id>": the engine makes its topics of the types
                    $type = str_contains((string) $q->import_key, ':') ? strstr($q->import_key, ':', true) : null;

                    return ['id' => $q->id, 'type' => $type, 'text' => $q->text, 'correct' => $correct->text, 'wrong' => array_values($wrong)];
                })->filter()->values();

                return [
                    'id' => $quiz->id, 'key' => $quiz->import_key, 'title' => $quiz->title,
                    'topic' => $quiz->tags->first()?->slug, 'level' => $level, 'questions' => $questions,
                ];
            })
            ->filter(fn ($q) => $q['topic'] !== null && count($q['questions']) > 0)->values();

        return response()->json(['quizzes' => $quizzes]);
    }
}
