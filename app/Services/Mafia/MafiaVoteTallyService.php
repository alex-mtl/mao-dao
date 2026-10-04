<?php

namespace App\Services\Mafia;

use Illuminate\Support\Collection;

/**
 * Pure vote-tallying for one round of the Mafia day-phase elimination
 * vote (plan §7's "Day phase" corrections). Any living voter who never
 * explicitly cast a vote defaults to the last candidate in nomination
 * order — this is the one rule that makes tallying non-trivial.
 *
 * Deciding what to *do* with the result — eliminate outright, run a
 * defense-speech re-vote on a shrinking tie, or fall back to the
 * "Eliminate ALL" lock motion on a persistent tie — is day-phase
 * state-machine logic that belongs to the full game engine (a later
 * phase of this build), not to this class. This only turns votes into
 * counts and finds the candidate(s) with the most.
 */
class MafiaVoteTallyService
{
    /**
     * @param  array<int, int>  $candidateOrderPlayerIds  Nomination order — the last entry is who undecided voters default to.
     * @param  Collection<int, array{voter_player_id: int, candidate_player_id: int}>  $votes  One entry per voter who explicitly cast a vote this round.
     * @param  Collection<int, int>  $livingVoterPlayerIds  Every player allowed to vote this round.
     * @return array{counts: array<int, int>, winners: array<int>}
     */
    public function tally(array $candidateOrderPlayerIds, Collection $votes, Collection $livingVoterPlayerIds): array
    {
        $votesByVoter = $votes->keyBy('voter_player_id');
        $lastCandidateId = end($candidateOrderPlayerIds);

        $counts = array_fill_keys($candidateOrderPlayerIds, 0);

        foreach ($livingVoterPlayerIds as $voterId) {
            $candidateId = $votesByVoter->get($voterId)['candidate_player_id'] ?? $lastCandidateId;

            if (array_key_exists($candidateId, $counts)) {
                $counts[$candidateId]++;
            }
        }

        $maxVotes = max($counts);
        $winners = $maxVotes > 0
            ? array_values(array_keys(array_filter($counts, fn (int $count) => $count === $maxVotes)))
            : [];

        return ['counts' => $counts, 'winners' => $winners];
    }
}
