<?php

namespace App\Http\Controllers;

use App\Models\Quiz;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redirect;

class QuizLikeController extends Controller
{
    public function store(Request $request, Quiz $quiz): RedirectResponse
    {
        $this->authorize('view', $quiz);

        $quiz->likes()->firstOrCreate(['user_id' => $request->user()->id]);

        return Redirect::back();
    }

    public function destroy(Request $request, Quiz $quiz): RedirectResponse
    {
        $quiz->likes()->where('user_id', $request->user()->id)->delete();

        return Redirect::back();
    }
}
