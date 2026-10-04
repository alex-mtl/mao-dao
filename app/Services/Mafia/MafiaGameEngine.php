<?php

namespace App\Services\Mafia;

use App\Events\Mafia\MafiaGameOver;
use App\Events\Mafia\MafiaPhaseChanged;
use App\Events\Mafia\MafiaPlayerConnectionChanged;
use App\Models\MafiaAction;
use App\Models\MafiaPlayer;
use App\Models\MafiaRoom;

/**
 * The full day/night phase state machine (plan §7), reusing the pure
 * MafiaShootResolver/MafiaVoteTallyService for the parts that are
 * directly unit-testable on their own. Every method here either resolves
 * the *current* phase/stage and immediately starts the *next* one, mirror
 * ing how ttl10's host.js functions work — there is no "manual host"
 * path in this build (see plan §3.1 #1/§10: autohost is fixed on, MVP
 * doesn't build the human-host control panel), so this engine is only
 * ever invoked from `mafia:tick` (MafiaTickService) once a room's
 * `phase_deadline_at` has passed. Player actions (nominate/vote/shoot/
 * checks/pass) never call into this engine directly — they only record a
 * MafiaAction row (see MafiaController); a "pass" is the one exception
 * that indirectly speeds things up, by setting `phase_deadline_at` to now
 * so the very next tick (≤500ms later) resolves the stage early.
 *
 * `MafiaRoom.state` is a per-day scratch pad for whatever the current
 * stage needs to track (speaking order, the voting queue, tie history,
 * ...) that isn't itself a logged action — see the mafia_rooms migration.
 *
 * Known, deliberate simplifications vs. ttl10 (documented rather than
 * silently dropped):
 * - A vote/lock-vote/shoot/check action is "latest wins" per actor per
 *   round (a player can freely change their mind up until the window
 *   closes) rather than being locked to a specific per-candidate window.
 */
class MafiaGameEngine
{
    public function __construct(
        private readonly MafiaShootResolver $shootResolver,
        private readonly MafiaVoteTallyService $voteTally,
    ) {
    }

    public function advance(MafiaRoom $room): void
    {
        match ($room->status) {
            'sitdown' => $this->startDonWatch($room),
            'don_watch' => $this->startSheriffWatch($room),
            'sheriff_watch' => $this->startDay($room, 1),
            'day' => $this->advanceDay($room),
            'night' => $this->startShooting($room),
            'shooting' => $this->finishShooting($room),
            'don_check' => $this->startSheriffCheck($room),
            'sheriff_check' => $this->startNextDay($room),
            default => null,
        };
    }

    private function advanceDay(MafiaRoom $room): void
    {
        match ($room->stage) {
            'morning_speech' => $this->beginSpeakingOrder($room),
            'speaking' => $this->advanceSpeaking($room),
            'voting' => $this->advanceVoting($room),
            'defense_speech' => $this->advanceDefenseSpeech($room),
            'lock_vote' => $this->resolveLockVote($room),
            'last_speech' => $this->resolveLastSpeech($room),
            default => null,
        };
    }

    // ---- disconnection (plan §8) ------------------------------------------
    //
    // Runs on every tick, independent of `advance()`/`phase_deadline_at` —
    // a player can go quiet during any phase, not just at a deadline, so
    // this can't be folded into the match arms above. Nothing here ever
    // touches `status`/`stage`; it only ever changes a MafiaPlayer's own
    // connection_status/status. "Every other alive player" is scoped to
    // real (non-dummy) players only — unlike the shooting-unanimity rule,
    // where a dummy on the mafia team blocking a kill forever is an
    // accepted, faithful emergent consequence of "dummies never act",
    // requiring a dummy's non-existent opinion on a *disconnect* vote
    // would make this whole safety net permanently useless in exactly the
    // short-handed games where it matters most — a deliberate, documented
    // deviation, not an oversight.

    public function flagDisconnectedPlayers(): void
    {
        $staleBefore = now()->subSeconds(config('mafia.player_disconnect_timeout_seconds'));

        MafiaPlayer::where('status', 'alive')
            ->where('connection_status', 'connected')
            ->whereNotNull('user_id')
            ->where('last_seen_at', '<', $staleBefore)
            ->whereHas('room', fn ($q) => $q->whereNotIn('status', ['lobby', 'game_over', 'cancelled']))
            ->get()
            ->each(function (MafiaPlayer $player) {
                $player->update(['connection_status' => 'disconnected', 'disconnected_at' => now()]);
                MafiaPlayerConnectionChanged::dispatch($player->room, $player->fresh());
            });
    }

    public function resolveDisconnectVotes(): void
    {
        MafiaPlayer::where('status', 'alive')
            ->where('connection_status', 'disconnected')
            ->whereNotNull('disconnected_at')
            ->get()
            ->each(fn (MafiaPlayer $player) => $this->resolveDisconnectVoteFor($player));
    }

    private function resolveDisconnectVoteFor(MafiaPlayer $disconnectedPlayer): void
    {
        $room = $disconnectedPlayer->room;

        if (in_array($room->status, ['lobby', 'game_over', 'cancelled'], true)) {
            return;
        }

        $otherRealVoterIds = $room->players()
            ->where('status', 'alive')
            ->where('id', '!=', $disconnectedPlayer->id)
            ->whereNotNull('user_id')
            ->pluck('id');

        if ($otherRealVoterIds->isEmpty()) {
            return;
        }

        $latestVotePerVoter = MafiaAction::where('mafia_room_id', $room->id)
            ->whereIn('action_type', ['disconnect_eliminate', 'disconnect_continue'])
            ->where('target_player_id', $disconnectedPlayer->id)
            ->where('created_at', '>=', $disconnectedPlayer->disconnected_at)
            ->orderBy('created_at')
            ->get()
            ->groupBy('actor_player_id')
            ->map(fn ($actions) => $actions->last());

        if (! $otherRealVoterIds->diff($latestVotePerVoter->keys())->isEmpty()) {
            return; // not everyone eligible has voted yet
        }

        $allEliminate = $latestVotePerVoter->every(fn (MafiaAction $a) => $a->action_type === 'disconnect_eliminate');
        $allContinue = $latestVotePerVoter->every(fn (MafiaAction $a) => $a->action_type === 'disconnect_continue');

        if ($allEliminate) {
            $disconnectedPlayer->update(['status' => 'disconnect_eliminated']);
            $room->refresh();
            $winnerTeam = $room->checkWinner();
            if ($winnerTeam) {
                $this->endGame($room, $winnerTeam);
            }

            return;
        }

        if ($allContinue) {
            // Restarts the window rather than clearing connection_status
            // outright — they may genuinely still be disconnected; this
            // just lets the same vote be raised again later instead of
            // permanently disappearing.
            $disconnectedPlayer->update(['disconnected_at' => now()]);
        }

        // A split decision (some eliminate, some continue) resolves
        // neither way and simply waits for someone to change their vote —
        // no branch needed, matching how an unresolved lock motion or tie
        // just sits until the next input changes the tally.
    }

    // ---- sitdown / don-watch / sheriff-watch --------------------------

    private function startDonWatch(MafiaRoom $room): void
    {
        $this->transition($room, status: 'don_watch', ms: 'don_watch');
    }

    private function startSheriffWatch(MafiaRoom $room): void
    {
        $this->transition($room, status: 'sheriff_watch', ms: 'sheriff_watch');
    }

    // ---- day: entry point ----------------------------------------------

    private function startDay(MafiaRoom $room, int $day): void
    {
        $carryOverVictimSlot = $room->dayState()['night_victim_slot'] ?? null;

        $room->update([
            'status' => 'day',
            'current_day' => $day,
            'state' => ['stage_started_at' => now()->toIso8601String()],
        ]);

        $victim = $carryOverVictimSlot ? $room->players()->where('slot', $carryOverVictimSlot)->first() : null;

        if ($victim) {
            $this->beginMorningSpeech($room, $victim->id);
        } else {
            $this->beginSpeakingOrder($room);
        }
    }

    /**
     * A day that opens on a night kill gives the victim one last word
     * before the town resumes discussion — a ttl10 flavor detail, not
     * just an elimination mechanic (the victim is already dead; this is
     * purely narrative, no status change happens here). Reuses
     * `current_elimination` as the "whose spotlight is this" field, same
     * as a real last speech — resolveLastSpeech is never reached from
     * this stage (advanceDay routes 'morning_speech' straight to
     * beginSpeakingOrder), so no `elimination_reason` means nothing is
     * ever applied against this player.
     */
    private function beginMorningSpeech(MafiaRoom $room, int $victimPlayerId): void
    {
        $room->update([
            'stage' => 'morning_speech',
            'state' => array_merge($room->dayState(), ['current_elimination' => $victimPlayerId]),
        ]);
        $this->transition($room, ms: 'last_speech', dispatch: true);
    }

    /**
     * Matches ttl10's rotating start-offset (host.js's nextSpeaker,
     * `slot >= room.game.day`): day N's discussion starts at slot N, not
     * always slot 1 — day 1 starts at 1, day 2 starts at 2 (so slot 1
     * ends up speaking last), day 3 starts at 3, and so on, wrapping back
     * through 1 once the offset passes the table size. This is a fairness
     * rule (nobody is permanently stuck always speaking first or last);
     * dead/dummy-eliminated slots are simply skipped since $livingSlots
     * already excludes them.
     */
    private function beginSpeakingOrder(MafiaRoom $room): void
    {
        $livingSlots = $room->players()->where('status', 'alive')->orderBy('slot')->pluck('slot')->all();

        $startSlot = (($room->current_day - 1) % config('mafia.seats')) + 1;

        $order = array_merge(
            array_values(array_filter($livingSlots, fn ($slot) => $slot >= $startSlot)),
            array_values(array_filter($livingSlots, fn ($slot) => $slot < $startSlot)),
        );

        $room->update([
            'stage' => 'speaking',
            'state' => array_merge($room->dayState(), [
                'speaking_order' => $order,
                'spoken_slots' => [],
            ]),
        ]);
        $this->transition($room, ms: 'speech', dispatch: true);
    }

    private function advanceSpeaking(MafiaRoom $room): void
    {
        $state = $room->dayState();
        $order = $state['speaking_order'] ?? [];
        $spoken = $state['spoken_slots'] ?? [];

        if (! empty($order)) {
            $spoken[] = array_shift($order);
        }
        $state = array_merge($state, ['speaking_order' => $order, 'spoken_slots' => $spoken]);

        if (! empty($order)) {
            $room->update(['state' => $state]);
            $this->transition($room, ms: 'speech', dispatch: true);

            return;
        }

        $room->update(['state' => $state]);
        $this->concludeDiscussion($room);
    }

    private function concludeDiscussion(MafiaRoom $room): void
    {
        $nominees = $room->currentNominees();
        $dayOneLoneNominee = $room->current_day === 1 && count($nominees) === 1;

        if (empty($nominees) || $dayOneLoneNominee) {
            $this->startNight($room);

            return;
        }

        $this->beginVotingRound($room, $nominees);
    }

    // ---- day: voting -----------------------------------------------------

    private function beginVotingRound(MafiaRoom $room, array $candidatePlayerIds): void
    {
        $room->update([
            'stage' => 'voting',
            'state' => array_merge($room->dayState(), [
                'voting_candidates' => $candidatePlayerIds,
                'voting_queue' => $candidatePlayerIds,
                'stage_started_at' => now()->toIso8601String(),
            ]),
        ]);
        $this->transition($room, ms: 'vote_round', dispatch: true);
    }

    private function advanceVoting(MafiaRoom $room): void
    {
        $state = $room->dayState();
        $queue = $state['voting_queue'] ?? [];

        if (! empty($queue)) {
            array_shift($queue);
        }
        $room->update(['state' => array_merge($state, ['voting_queue' => $queue])]);

        if (! empty($queue)) {
            $this->transition($room, ms: 'vote_round', dispatch: true);

            return;
        }

        $this->resolveVotingRound($room);
    }

    private function resolveVotingRound(MafiaRoom $room): void
    {
        $state = $room->dayState();
        $candidates = $state['voting_candidates'] ?? [];
        $stageStartedAt = $state['stage_started_at'] ?? now()->toIso8601String();

        $livingVoterIds = $room->players()->where('status', 'alive')->pluck('id');
        $votes = $this->latestActionsSince($room, 'vote', $stageStartedAt)
            ->map(fn (MafiaAction $a) => ['voter_player_id' => $a->actor_player_id, 'candidate_player_id' => $a->target_player_id]);

        $result = $this->voteTally->tally($candidates, $votes, $livingVoterIds);
        $winners = $result['winners'];

        if (count($winners) === 1) {
            $room->update(['state' => array_merge($state, ['pending_eliminations' => [$winners[0]]])]);
            $this->processPendingEliminations($room, 'voted_out');

            return;
        }

        $previousTie = $state['previous_tie'] ?? null;
        $tieShrank = $previousTie === null || count($winners) < count($previousTie);

        if ($tieShrank) {
            $this->beginDefenseSpeech($room, $winners);
        } else {
            $this->beginLockVote($room, $winners);
        }
    }

    private function beginDefenseSpeech(MafiaRoom $room, array $tiedPlayerIds): void
    {
        $room->update([
            'stage' => 'defense_speech',
            'state' => array_merge($room->dayState(), [
                'previous_tie' => $tiedPlayerIds,
                'defense_queue' => $tiedPlayerIds,
                'stage_started_at' => now()->toIso8601String(),
            ]),
        ]);
        $this->transition($room, ms: 'defense_speech', dispatch: true);
    }

    private function advanceDefenseSpeech(MafiaRoom $room): void
    {
        $state = $room->dayState();
        $queue = $state['defense_queue'] ?? [];

        if (! empty($queue)) {
            array_shift($queue);
        }
        $room->update(['state' => array_merge($state, ['defense_queue' => $queue])]);

        if (! empty($queue)) {
            $this->transition($room, ms: 'defense_speech', dispatch: true);

            return;
        }

        // Every tied candidate has spoken — re-vote among just that set.
        $this->beginVotingRound($room, $room->dayState()['previous_tie']);
    }

    private function beginLockVote(MafiaRoom $room, array $tiedPlayerIds): void
    {
        $room->update([
            'stage' => 'lock_vote',
            'state' => array_merge($room->dayState(), [
                'lock_vote_candidates' => $tiedPlayerIds,
                'stage_started_at' => now()->toIso8601String(),
            ]),
        ]);
        $this->transition($room, ms: 'lock_vote', dispatch: true);
    }

    private function resolveLockVote(MafiaRoom $room): void
    {
        $state = $room->dayState();
        $candidates = $state['lock_vote_candidates'] ?? [];
        $stageStartedAt = $state['stage_started_at'] ?? now()->toIso8601String();

        $livingCount = $room->players()->where('status', 'alive')->count();
        $yesVotes = $this->latestActionsSince($room, 'lock_vote', $stageStartedAt)->count();

        // A strict majority of everyone alive, not just of those who
        // bothered to press the button — silence counts as "no" (plan §7).
        $passed = $yesVotes * 2 > $livingCount;

        if ($passed) {
            $room->update(['state' => array_merge($state, ['pending_eliminations' => $candidates])]);
            $this->processPendingEliminations($room, 'locked');

            return;
        }

        $this->startNight($room);
    }

    // ---- day: elimination / last speech --------------------------------

    private function processPendingEliminations(MafiaRoom $room, string $reason): void
    {
        $state = $room->dayState();
        $pending = $state['pending_eliminations'] ?? [];

        if (empty($pending)) {
            $this->startNight($room);

            return;
        }

        $next = array_shift($pending);
        $room->update([
            'stage' => 'last_speech',
            'state' => array_merge($state, [
                'pending_eliminations' => $pending,
                'current_elimination' => $next,
                'elimination_reason' => $reason,
            ]),
        ]);
        $this->transition($room, ms: 'last_speech', dispatch: true);
    }

    private function resolveLastSpeech(MafiaRoom $room): void
    {
        $state = $room->dayState();
        $playerId = $state['current_elimination'] ?? null;
        $reason = $state['elimination_reason'] ?? null;

        if ($playerId && $reason) {
            MafiaPlayer::whereKey($playerId)->update(['status' => $reason === 'locked' ? 'locked' : 'voted_out']);
        }

        $room->refresh();
        $winnerTeam = $room->checkWinner();

        if ($winnerTeam) {
            $this->endGame($room, $winnerTeam);

            return;
        }

        if (! empty($room->dayState()['pending_eliminations'] ?? [])) {
            $this->processPendingEliminations($room, $reason ?? 'voted_out');

            return;
        }

        $this->startNight($room);
    }

    // ---- night / shooting / checks --------------------------------------

    private function startNight(MafiaRoom $room): void
    {
        $room->update(['status' => 'night', 'stage' => null]);
        $this->transition($room, ms: 'night_handoff', dispatch: true);
    }

    private function startShooting(MafiaRoom $room): void
    {
        $room->update(['status' => 'shooting', 'state' => array_merge($room->dayState(), [
            'stage_started_at' => now()->toIso8601String(),
        ])]);
        $this->transition($room, ms: 'shooting', dispatch: true);
    }

    private function finishShooting(MafiaRoom $room): void
    {
        $state = $room->dayState();
        $stageStartedAt = $state['stage_started_at'] ?? now()->toIso8601String();

        $livingBlackIds = $room->players()->where('status', 'alive')->whereIn('role', ['mafia', 'don'])->pluck('id');
        $shots = $this->latestActionsSince($room, 'shoot', $stageStartedAt)
            ->map(fn (MafiaAction $a) => ['actor_player_id' => $a->actor_player_id, 'target_player_id' => $a->target_player_id]);

        $targetId = $this->shootResolver->resolve($shots, $livingBlackIds);

        $victimSlot = null;
        if ($targetId) {
            $victim = MafiaPlayer::find($targetId);
            if ($victim && $victim->status === 'alive') {
                $victim->update(['status' => 'killed']);
                $victimSlot = $victim->slot;
            }
        }

        $room->update(['state' => array_merge($state, ['night_victim_slot' => $victimSlot])]);
        $room->refresh();

        $winnerTeam = $room->checkWinner();
        if ($winnerTeam) {
            $this->endGame($room, $winnerTeam);

            return;
        }

        $this->startDonCheck($room);
    }

    private function startDonCheck(MafiaRoom $room): void
    {
        $this->transition($room, status: 'don_check', ms: 'don_check');
    }

    private function startSheriffCheck(MafiaRoom $room): void
    {
        $this->transition($room, status: 'sheriff_check', ms: 'sheriff_check');
    }

    private function startNextDay(MafiaRoom $room): void
    {
        $this->startDay($room, $room->current_day + 1);
    }

    private function endGame(MafiaRoom $room, string $winnerTeam): void
    {
        $room->update([
            'status' => 'game_over',
            'stage' => null,
            'winner_team' => $winnerTeam,
            'phase_deadline_at' => null,
            'finished_at' => now(),
        ]);

        MafiaGameOver::dispatch($room->fresh());
    }

    // ---- shared helpers ---------------------------------------------------

    /**
     * Sets the room's next deadline (and optionally its status) and
     * broadcasts the transition. `dispatch: false` is used for the two
     * plain watch phases (don_watch/sheriff_watch) where the status
     * change itself already needs saving right before this is called —
     * kept as one call for those to avoid two writes for a one-field
     * change.
     */
    private function transition(MafiaRoom $room, ?string $status = null, string $ms = '', bool $dispatch = true): void
    {
        $room->update(array_filter([
            'status' => $status,
            'phase_deadline_at' => now()->addMilliseconds(config("mafia.timers_ms.{$ms}")),
        ], fn ($v) => $v !== null));

        if ($dispatch) {
            MafiaPhaseChanged::dispatch($room->fresh());
        }
    }

    /**
     * Each actor's most recent action of a given type since a stage
     * began — the "latest action wins" rule applied uniformly to votes,
     * lock-votes, and shots (see the class docblock).
     */
    private function latestActionsSince(MafiaRoom $room, string $actionType, string $since)
    {
        return MafiaAction::where('mafia_room_id', $room->id)
            ->where('action_type', $actionType)
            ->where('created_at', '>=', $since)
            ->orderBy('created_at')
            ->get()
            ->groupBy('actor_player_id')
            ->map(fn ($actions) => $actions->last())
            ->values();
    }
}
