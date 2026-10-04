<?php

namespace App\Services\Mafia;

use Illuminate\Support\Collection;

/**
 * Pure resolution logic for the mafia team's nightly kill vote (plan
 * §7/§9). The kill only lands if every living black-team member submitted
 * the same target this night — a single missing vote or disagreement
 * means nobody dies. Deliberately decoupled from Eloquent so it's trivial
 * to unit test: callers map that night's `shooting` MafiaAction rows into
 * plain arrays before calling.
 */
class MafiaShootResolver
{
    /**
     * @param  Collection<int, array{actor_player_id: int, target_player_id: ?int}>  $shots  One entry per shot actually submitted this night.
     * @param  Collection<int, int>  $livingBlackPlayerIds  Every black-team player who was alive when the night began.
     * @return int|null The agreed-upon target's player id, or null if nobody dies.
     */
    public function resolve(Collection $shots, Collection $livingBlackPlayerIds): ?int
    {
        if ($livingBlackPlayerIds->isEmpty()) {
            return null;
        }

        $shotsByActor = $shots->keyBy('actor_player_id');

        $everyoneVoted = $livingBlackPlayerIds->every(fn (int $id) => $shotsByActor->has($id));
        if (! $everyoneVoted) {
            return null;
        }

        $targets = $livingBlackPlayerIds->map(fn (int $id) => $shotsByActor->get($id)['target_player_id']);

        if ($targets->contains(null)) {
            return null;
        }

        return $targets->unique()->count() === 1 ? $targets->first() : null;
    }
}
