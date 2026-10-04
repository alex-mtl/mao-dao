<?php

namespace App\Http\Controllers;

use App\Models\Quiz;
use App\Models\Tag;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class QuizLibraryController extends Controller
{
    public function index(Request $request): Response
    {
        $search = trim((string) $request->query('search', ''));
        $tagId = $request->query('tag');
        $language = $request->query('language');

        $quizzes = Quiz::query()
            ->published()
            ->with(['user:id,name', 'tags:id,name'])
            ->withCount('questions')
            ->when($search !== '', fn ($query) => $query->where('title', 'like', '%'.$search.'%'))
            ->when($tagId, fn ($query) => $query->whereHas(
                'tags',
                fn ($tagQuery) => $tagQuery->where('tags.id', $tagId),
            ))
            ->when($language, fn ($query) => $query->where('language', $language))
            ->orderByDesc('published_at')
            ->paginate(12)
            ->withQueryString();

        return Inertia::render('Quizzes/Library', [
            'quizzes' => $quizzes,
            'tags' => Tag::orderBy('name')->get(['id', 'name']),
            'filters' => [
                'search' => $search,
                'tag' => $tagId ? (int) $tagId : null,
                'language' => $language,
            ],
        ]);
    }

    public function show(Request $request, Quiz $quiz): Response
    {
        $this->authorize('view', $quiz);

        $quiz->load(['user:id,name', 'tags:id,name']);
        $quiz->loadCount(['questions', 'likes']);

        $canCopy = $request->user()->can('copy', $quiz);

        $stats = $quiz->attempts()
            ->selectRaw('count(*) as attempts_count')
            ->selectRaw('avg(percentage) as average_percentage')
            ->selectRaw('avg(time_spent_seconds) as average_time_spent_seconds')
            ->first();

        return Inertia::render('Quizzes/Show', [
            'quiz' => [
                'id' => $quiz->id,
                'title' => $quiz->title,
                'description' => $quiz->description,
                'language' => $quiz->language,
                'status' => $quiz->status,
                'allow_copying' => $quiz->allow_copying,
                'estimated_minutes' => $quiz->estimated_minutes,
                'questions_count' => $quiz->questions_count,
                'likes_count' => $quiz->likes_count,
                'attempts_count' => (int) $stats->attempts_count,
                'average_percentage' => $stats->average_percentage !== null
                    ? (int) round($stats->average_percentage)
                    : null,
                'average_time_spent_minutes' => $stats->average_time_spent_seconds !== null
                    ? (int) round($stats->average_time_spent_seconds / 60)
                    : null,
                'liked_by_user' => $quiz->likes()->where('user_id', $request->user()->id)->exists(),
                'can_copy' => $canCopy,
                'tags' => $quiz->tags,
                'owner' => $quiz->user,
                'is_owner' => $quiz->user_id === $request->user()->id,
            ],
        ]);
    }
}
