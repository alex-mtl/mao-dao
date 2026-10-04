<?php

declare(strict_types=1);

return [
    /*
     * Minimum percentage of correct answers required for an attempt to be
     * marked as passed. Centralized here so scoring logic (and any future
     * UI that displays the threshold) has a single source of truth.
     */
    'passing_threshold_percent' => 60,
];
