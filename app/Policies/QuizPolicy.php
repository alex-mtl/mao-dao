<?php

namespace App\Policies;

use App\Models\Quiz;
use App\Models\User;

class QuizPolicy
{
    /**
     * Published quizzes are visible to everyone, signed in or not; draft
     * quizzes only to their owner.
     */
    public function view(?User $user, Quiz $quiz): bool
    {
        return $quiz->isPublished() || ($user !== null && $user->id === $quiz->user_id);
    }

    public function update(User $user, Quiz $quiz): bool
    {
        return $user->id === $quiz->user_id;
    }

    public function delete(User $user, Quiz $quiz): bool
    {
        return $user->id === $quiz->user_id;
    }

    public function publish(User $user, Quiz $quiz): bool
    {
        return $user->id === $quiz->user_id;
    }

    /**
     * The owner can always duplicate their own quiz; anyone else needs
     * allow_copying to be enabled.
     */
    public function copy(User $user, Quiz $quiz): bool
    {
        return $user->id === $quiz->user_id || $quiz->allow_copying;
    }
}
