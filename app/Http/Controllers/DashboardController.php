<?php

namespace App\Http\Controllers;

use App\Services\QuizRecommendationService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function index(Request $request, QuizRecommendationService $recommendations): Response
    {
        $user = $request->user();

        return Inertia::render('Dashboard', [
            'recommendedQuizzes' => $recommendations->forUser($user)
                ->with('user:id,name')
                ->limit(5)
                ->get(['quizzes.id', 'quizzes.title', 'quizzes.user_id']),

            'recentAttempts' => $user->quizAttempts()
                ->with('quiz:id,title')
                ->orderByDesc('created_at')
                ->limit(5)
                ->get(),

            'myQuizzes' => $user->quizzes()
                ->orderByDesc('updated_at')
                ->limit(5)
                ->get(['id', 'title', 'status']),

            'likedQuizzes' => $user->likedQuizzes()
                ->orderByDesc('quiz_likes.created_at')
                ->limit(5)
                ->get(['quizzes.id', 'quizzes.title']),

            'pendingFriendRequests' => $user->receivedFriendRequests()
                ->where('status', 'pending')
                ->with('sender:id,name')
                ->get(),

            'groups' => $user->groups()
                ->withCount('members')
                ->limit(5)
                ->get(),
        ]);
    }
}
