<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\QuizRecommendationService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function index(Request $request, QuizRecommendationService $recommendations): Response
    {
        $user = $request->user();

        return Inertia::render('Dashboard', [
            'onboarding' => $this->onboarding($user),

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

    /**
     * Steps are derived from real activity on every load, so they tick
     * themselves off. The checklist disappears once dismissed (persisted
     * per account) or once all three steps are done.
     *
     * @return array{played: bool, created: bool, friend: bool}|null
     */
    private function onboarding(User $user): ?array
    {
        if ($user->onboarding_dismissed_at !== null) {
            return null;
        }

        $steps = [
            'played' => $user->quizAttempts()->exists(),
            'created' => $user->quizzes()->exists(),
            'friend' => $user->sentFriendRequests()->exists() || $user->acceptedFriendRequests()->exists(),
        ];

        return in_array(false, $steps, true) ? $steps : null;
    }

    public function dismissOnboarding(Request $request): RedirectResponse
    {
        $request->user()->forceFill(['onboarding_dismissed_at' => now()])->save();

        return back();
    }
}
