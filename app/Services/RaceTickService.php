<?php

namespace App\Services;

use App\Events\Race\RaceCancelled;
use App\Events\Race\RaceFinished;
use App\Events\Race\RaceQuestionEnded;
use App\Events\Race\RaceQuestionStarted;
use App\Models\RaceRoom;

/**
 * The authoritative timing engine for Race Mode. Reverb only delivers
 * pushes to clients — it has no scheduling capability of its own, and
 * this app has no queue worker or cron scheduler running (see CLAUDE.md),
 * so something has to actively decide "time's up" and drive the state
 * machine forward. That's this class: one `tick()` call advances every
 * room whose server-recorded deadline has already passed. It's called in
 * a loop by the supervised `race:tick` Artisan command, and is a plain,
 * directly testable class on its own so tests don't need to run (or
 * interrupt) that loop.
 */
class RaceTickService
{
    public function tick(): void
    {
        $this->cancelAbandonedLobbies();
        $this->advanceStartingRooms();
        $this->advanceActiveQuestions();
        $this->advanceQuestionResults();
    }

    /**
     * A silent host disconnect before the race starts (tab closed, no
     * explicit Leave click) — cancel the lobby rather than leave it
     * orphaned. Detected via the host's RacePlayer.last_seen_at, kept
     * fresh by ResolveRacePlayer's heartbeat touch on every Race request
     * plus useRaceChannel.js's periodic ping — no presence channel needed.
     */
    private function cancelAbandonedLobbies(): void
    {
        $staleBefore = now()->subSeconds(config('race.host_disconnect_timeout_seconds'));

        RaceRoom::where('status', 'lobby')
            ->whereHas('players', fn ($query) => $query
                ->where('is_host', true)
                ->where('last_seen_at', '<', $staleBefore))
            ->each(function (RaceRoom $room) {
                $room->update(['status' => 'cancelled']);
                RaceCancelled::dispatch($room);
            });
    }

    private function advanceStartingRooms(): void
    {
        RaceRoom::where('status', 'starting')
            ->where('started_at', '<=', now())
            ->each(fn (RaceRoom $room) => $this->beginQuestion($room, 0));
    }

    private function advanceActiveQuestions(): void
    {
        RaceRoom::where('status', 'question')
            ->where('current_question_deadline_at', '<=', now())
            ->each(function (RaceRoom $room) {
                $room->update([
                    'status' => 'question_results',
                    'results_reveal_until' => now()->addSeconds(config('race.results_reveal_seconds')),
                ]);

                RaceQuestionEnded::dispatch($room);
            });
    }

    private function advanceQuestionResults(): void
    {
        RaceRoom::where('status', 'question_results')
            ->where('results_reveal_until', '<=', now())
            ->each(function (RaceRoom $room) {
                $nextIndex = $room->current_question_index + 1;

                if ($nextIndex < count($room->question_order ?? [])) {
                    $this->beginQuestion($room, $nextIndex);
                } else {
                    $room->update(['status' => 'finished', 'finished_at' => now()]);
                    RaceFinished::dispatch($room);
                }
            });
    }

    private function beginQuestion(RaceRoom $room, int $index): void
    {
        $room->update([
            'status' => 'question',
            'current_question_index' => $index,
            'current_question_started_at' => now(),
            'current_question_deadline_at' => now()->addSeconds(config('race.question_time_limit_seconds')),
        ]);

        RaceQuestionStarted::dispatch($room);
    }
}
