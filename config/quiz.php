<?php

declare(strict_types=1);

return [
    /*
     * Minimum percentage of correct answers required for an attempt to be
     * marked as passed. Centralized here so scoring logic (and any future
     * UI that displays the threshold) has a single source of truth.
     */
    'passing_threshold_percent' => 60,

    /*
     * Generated questions (services/quiz-factory) -> POST /internal/quizzes/import, header
     * X-Internal-Secret. Without a secret the endpoint answers 403. Imported quizzes belong
     * to the user QUIZ_IMPORT_USER_ID.
     */
    'import_secret' => env('QUIZ_IMPORT_SECRET'),
    'import_user_id' => env('QUIZ_IMPORT_USER_ID'),
];
