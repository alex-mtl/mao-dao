<?php

declare(strict_types=1);

return [
    /*
     * Fixed table size — see the "Mafia Extension" plan §3.1(#3). Not
     * configurable per room for MVP.
     */
    'seats' => 10,

    /*
     * The fixed 10-role deck dealt every game, taken directly from
     * ttl10's `host.js` (`shuffleArray(['R','D','B','S','R','B','R','R','R','R'])`):
     * 6 citizens, 1 sheriff, 2 mafia, 1 don. Dealt across all 10 seats
     * regardless of headcount — an unfilled seat still gets a role and
     * plays on as a "dummy" (see mafia_players migration).
     */
    'role_deck' => ['citizen', 'citizen', 'citizen', 'citizen', 'citizen', 'citizen', 'sheriff', 'mafia', 'mafia', 'don'],

    'teams' => [
        'citizen' => 'red',
        'sheriff' => 'red',
        'mafia' => 'black',
        'don' => 'black',
    ],

    /*
     * Discipline ladder (see plan §9). A player's 3rd warning shortens
     * their next speaking turn; a 4th disqualifies them outright, counted
     * the same as being killed or voted out for every purpose (win check,
     * vote eligibility, speaking order).
     */
    'warn_speech_after' => 3,
    'disqualify_after_warnings' => 4,

    /*
     * Every phase timer from the corrected timing table in the plan
     * (§9/§1.1), in milliseconds — kept as one unit throughout (rather
     * than mixing seconds and ms) since the shooting window is a genuine
     * sub-second value (3.5s) that doesn't fit an integer-seconds column.
     * mafia:tick reads these to compute each room's phase_deadline_at.
     */
    'timers_ms' => [
        'night_handoff' => 500,
        'sitdown' => 62_000,
        'don_watch' => 5_000,
        'sheriff_watch' => 5_000,
        'speech' => 60_000,
        'warned_speech' => 10_000,
        'shout_out' => 5_000,
        'vote_round' => 3_000,
        'lock_vote' => 3_000,
        'last_speech' => 60_000,
        'defense_speech' => 30_000,
        'shooting' => 3_500,
        'don_check' => 11_000,
        'sheriff_check' => 11_000,
    ],

    /*
     * A lobby whose game-host hasn't been seen (no heartbeat/request) for
     * this long is treated as abandoned and cancelled by mafia:tick —
     * same pattern and same reasoning as race.host_disconnect_timeout_seconds.
     */
    'lobby_host_disconnect_timeout_seconds' => 30,

    /*
     * An in-game player whose last_seen_at is older than this is flagged
     * "disconnected" by mafia:tick (plan §8) — separate from, and shorter
     * than, the lobby timeout above since a mid-game silence should be
     * caught faster (it blocks the whole table's progress on votes/night
     * actions, not just one player's own lobby wait).
     */
    'player_disconnect_timeout_seconds' => 20,

    /*
     * How often the Lobby/Play pages ping the server to keep last_seen_at
     * fresh while a tab is open but otherwise idle.
     */
    'heartbeat_interval_seconds' => 12,

    /*
     * mafia:cleanup (added alongside the full phase engine in Phase 3)
     * deletes finished/cancelled rooms older than this, mirroring
     * race.cleanup_after_hours.
     */
    'cleanup_after_hours' => 24,

    /*
     * Voice/video (Phase 7) — a standalone Node.js mediasoup sidecar
     * (media-sfu/), never a PHP process, since mediasoup's native worker
     * has nothing to do with PHP-FPM. Laravel's role is limited to
     * issuing a short-lived signed join token per player
     * (MafiaController::mediaToken()) and answering the sidecar's
     * server-to-server "can this viewer see this target right now"
     * question (routes/web.php's internal.mafia.can-view) — the sidecar
     * itself has no idea what a role or a phase is. `media_shared_secret`
     * MUST equal media-sfu/.env's own SHARED_SECRET exactly, or every
     * token verification and can-view call fails closed.
     */
    'media_shared_secret' => env('MEDIA_SFU_SHARED_SECRET'),
    'media_ws_url' => env('MEDIA_SFU_WS_URL', 'ws://127.0.0.1:8381'),
    'media_token_ttl_seconds' => 60,
    // Where Laravel reaches the sidecar's own HTTP port to nudge it right
    // after a phase change (so the speaker handoff is instant instead of
    // waiting for the sidecar's 1s poll). Unset in tests; connection errors
    // are swallowed, the poll is the safety net.
    // At most this many viewers per room (guests included), and how recently
    // a viewer must have been seen to count as still watching.
    'spectator_limit' => 20,
    'spectator_active_seconds' => 45,

    'media_internal_url' => env('MEDIA_SFU_INTERNAL_URL', env('APP_ENV') === 'testing' ? null : 'http://127.0.0.1:8381'),
];
