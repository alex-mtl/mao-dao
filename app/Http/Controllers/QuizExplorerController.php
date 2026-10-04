<?php

namespace App\Http\Controllers;

use App\Services\QuizRecommendationService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class QuizExplorerController extends Controller
{
    public function index(Request $request, QuizRecommendationService $recommendations): Response
    {
        $quizzes = $recommendations->forUser($request->user())
            ->with(['user:id,name', 'tags:id,name'])
            ->withCount('questions')
            ->paginate(12)
            ->withQueryString();

        return Inertia::render('Quizzes/Explorer', [
            'quizzes' => $quizzes,
        ]);
    }
}
