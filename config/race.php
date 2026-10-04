<?php

declare(strict_types=1);

return [
    /*
     * Default maximum number of players per Race Room. Enforced server-side
     * on join, not just in the UI.
     */
    'default_max_players' => 10,

    /*
     * How long players have to answer each question, in seconds. The
     * authoritative deadline stored on the room is computed from this, not
     * from anything a client sends.
     */
    'question_time_limit_seconds' => 15,

    /*
     * Fixed countdown shown between "host starts" and the first question.
     */
    'countdown_seconds' => 3,

    /*
     * How long the question-results/leaderboard screen is shown before the
     * room advances to the next question (or to final results).
     */
    'results_reveal_seconds' => 5,

    /*
     * Scoring formula inputs (see App\Services\RaceScoringService). A
     * correct answer always earns the base points, plus up to the max
     * speed bonus depending on how quickly it was submitted.
     */
    'base_points' => 1000,
    'max_speed_bonus' => 500,

    /*
     * A lobby whose host hasn't been seen (no heartbeat/request from
     * their session) for this long is treated as abandoned and cancelled
     * by race:tick — the simplest robust option for a silent host
     * disconnect before the race starts (no host-transfer bookkeeping).
     * Comfortably above the frontend's heartbeat interval so a couple of
     * missed beats don't false-positive.
     */
    'host_disconnect_timeout_seconds' => 30,

    /*
     * How often the Lobby/Play pages ping the server to keep last_seen_at
     * fresh while a tab is open but otherwise idle (see useRaceChannel.js).
     */
    'heartbeat_interval_seconds' => 12,

    /*
     * race:cleanup deletes finished/cancelled rooms older than this, so
     * the table doesn't grow without bound. Run manually or via a cron
     * entry (`php artisan race:cleanup`) — this app has no scheduler
     * wired up, so it isn't automatic yet.
     */
    'cleanup_after_hours' => 24,
];
