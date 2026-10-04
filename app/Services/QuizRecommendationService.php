<?php

namespace App\Services;

use App\Models\Quiz;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Ranks published quizzes for a user with a single, explicit weighted
 * score — no external search/ML service, per spec section 33. The
 * formula:
 *
 *   score = 2 * (tags the quiz shares with the user's selected interests)
 *         + 1 * (tags the quiz shares with quizzes the user has liked)
 *         + 1 * (tags the quiz shares with quizzes the user has passed)
 *         + 1 * (quiz language matches the user's UI language)
 *
 * Quizzes the user has already attempted are excluded outright (repeatedly
 * recommending something already played isn't useful), as are the user's
 * own quizzes (those live in "My Quizzes", not the discovery feed).
 * Quizzes in other languages are never excluded — language only adds a
 * small bonus, matching "do not completely exclude quizzes in other
 * languages" from spec section 33.
 */
class QuizRecommendationService
{
    public function forUser(User $user): Builder
    {
        $userTagIds = $user->tags()->pluck('tags.id')->all();

        $likedTagIds = DB::table('quiz_tag')
            ->whereIn('quiz_id', DB::table('quiz_likes')->select('quiz_id')->where('user_id', $user->id))
            ->pluck('tag_id')
            ->unique()
            ->values()
            ->all();

        $passedTagIds = DB::table('quiz_tag')
            ->whereIn('quiz_id', DB::table('quiz_attempts')->select('quiz_id')->where('user_id', $user->id)->where('passed', true))
            ->pluck('tag_id')
            ->unique()
            ->values()
            ->all();

        $attemptedQuizIds = DB::table('quiz_attempts')
            ->select('quiz_id')
            ->where('user_id', $user->id);

        return Quiz::query()
            ->published()
            ->where('user_id', '!=', $user->id)
            ->whereNotIn('id', $attemptedQuizIds)
            ->withCount([
                'tags as tag_overlap_score' => fn ($query) => $query->whereIn('tags.id', $userTagIds),
                'tags as liked_tag_score' => fn ($query) => $query->whereIn('tags.id', $likedTagIds),
                'tags as passed_tag_score' => fn ($query) => $query->whereIn('tags.id', $passedTagIds),
            ])
            ->selectRaw('(language = ?) as language_score', [$user->ui_language])
            ->orderByRaw(
                '(tag_overlap_score * 2 + liked_tag_score + passed_tag_score + language_score) desc',
            )
            ->orderByDesc('published_at');
    }
}
