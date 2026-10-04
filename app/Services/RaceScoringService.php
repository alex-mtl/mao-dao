<?php

namespace App\Services;

/**
 * Deterministic, server-only scoring for Race Mode answers. A correct
 * answer always earns the base points plus a speed bonus that decreases
 * linearly to 0 as the response time approaches the question's time limit;
 * an incorrect answer always earns 0, regardless of speed. Never accepts
 * a client-reported score or time — callers must pass a server-recorded
 * response time.
 */
class RaceScoringService
{
    public function score(bool $isCorrect, int $responseTimeMs, int $timeLimitMs): int
    {
        if (! $isCorrect) {
            return 0;
        }

        $basePoints = config('race.base_points');
        $maxSpeedBonus = config('race.max_speed_bonus');

        $elapsedFraction = min(1, max(0, $responseTimeMs / max(1, $timeLimitMs)));
        $speedBonus = (int) round($maxSpeedBonus * (1 - $elapsedFraction));

        return $basePoints + $speedBonus;
    }
}
