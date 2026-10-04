<?php

namespace App\Services\Mafia;

/**
 * Pure rules for the warning/discipline ladder (plan §9). A player's 3rd
 * warning shortens their next speaking turn from the normal 60s down to
 * 10s; a 4th disqualifies them outright, counted the same as being killed
 * or voted out for every game-engine purpose.
 */
class MafiaDisciplineService
{
    public function speechMillisecondsFor(int $warnings): int
    {
        return $warnings >= config('mafia.warn_speech_after')
            ? config('mafia.timers_ms.warned_speech')
            : config('mafia.timers_ms.speech');
    }

    public function isDisqualified(int $warnings): bool
    {
        return $warnings >= config('mafia.disqualify_after_warnings');
    }
}
