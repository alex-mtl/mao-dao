<?php

namespace App\Policies;

use App\Models\QuizAttempt;
use App\Models\User;

class QuizAttemptPolicy
{
    public function view(User $user, QuizAttempt $quizAttempt): bool
    {
        return $user->id === $quizAttempt->user_id;
    }
}
