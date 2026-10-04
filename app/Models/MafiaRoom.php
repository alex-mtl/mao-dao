<?php

namespace App\Models;

use Database\Factories\MafiaRoomFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'host_user_id', 'room_code', 'status', 'stage', 'state', 'settings', 'current_day',
    'phase_deadline_at', 'winner_team', 'started_at', 'finished_at',
])]
class MafiaRoom extends Model
{
    /** @use HasFactory<MafiaRoomFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            'settings' => 'array',
            'state' => 'array',
            'phase_deadline_at' => 'datetime',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    /**
     * The current day's scratch-pad state (speaking order, nominees, the
     * voting queue, ...) — see the mafia_rooms migration's comment.
     * Never null in practice once a day has started; defaults to an empty
     * array so callers don't need a null-check for a room still in the
     * lobby.
     */
    public function dayState(): array
    {
        return $this->state ?? [];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(User::class, 'host_user_id');
    }

    public function players(): HasMany
    {
        return $this->hasMany(MafiaPlayer::class);
    }

    public function actions(): HasMany
    {
        return $this->hasMany(MafiaAction::class);
    }

    public function isJoinable(): bool
    {
        return $this->status === 'lobby' && $this->players()->count() < config('mafia.seats');
    }

    public function isFull(): bool
    {
        return $this->players()->count() >= config('mafia.seats');
    }

    /**
     * Server-authoritative win check, run after every elimination — see
     * the "Mafia Extension" plan §6/§9. Town wins once every black-team
     * player is gone; the mafia wins the moment their living count
     * reaches parity with the town's (they don't need to eliminate
     * everyone, just stop being outnumbered). Dummy seats (see
     * MafiaPlayer::team()) count toward these totals exactly like a real
     * player would, since they still hold a dealt role.
     */
    public function checkWinner(): ?string
    {
        $alive = $this->players()->where('status', 'alive')->get();

        $redCount = $alive->filter(fn (MafiaPlayer $player) => $player->team() === 'red')->count();
        $blackCount = $alive->filter(fn (MafiaPlayer $player) => $player->team() === 'black')->count();

        if ($blackCount === 0 && $redCount > 0) {
            return 'red';
        }

        if ($blackCount > 0 && $blackCount === $redCount) {
            return 'black';
        }

        return null;
    }

    /**
     * The current day's active accusations, ordered by when each became
     * the accuser's current pick (not necessarily when the target was
     * first ever accused — changing your mind moves your new pick to the
     * back of the order, a deliberate simplification of ttl10's model).
     * Shared by MafiaGameEngine (deciding whether/how to start voting)
     * and MafiaController's state payload (showing live accusations
     * during the speaking stage), so it lives here rather than in either
     * of them.
     *
     * A `null` target on an actor's latest nominate action means they
     * re-clicked their own current pick to withdraw it (matches ttl10's
     * own accuser-toggle behavior — see MafiaController::nominate()) —
     * that actor simply contributes no entry here, same as if they'd
     * never nominated anyone today.
     */
    public function currentNominees(): array
    {
        $latestPerAccuser = MafiaAction::where('mafia_room_id', $this->id)
            ->where('action_type', 'nominate')
            ->where('day', $this->current_day)
            ->orderBy('created_at')
            ->get()
            ->groupBy('actor_player_id')
            ->map(fn ($actions) => $actions->last())
            ->sortBy('created_at');

        $order = [];
        foreach ($latestPerAccuser as $action) {
            if ($action->target_player_id !== null && ! in_array($action->target_player_id, $order, true)) {
                $order[] = $action->target_player_id;
            }
        }

        return $order;
    }

    /**
     * The single source of truth for video/audio visibility (plan
     * Phase 7) — both `MafiaController::roomSnapshot()` (deciding what
     * to show a viewer) and the media-sfu sidecar's internal can-view
     * endpoint (deciding whether to actually let a `consume` request
     * through) call this, so the rule is enforced the same way whether
     * or not a client bothers to hide what it wasn't supposed to see.
     * Mirrors ttl10's own video-reveal behavior: the mafia team can see
     * each other while plotting (sitdown) and while choosing a target
     * (night/shooting), and everyone alive can see everyone alive during
     * open daytime discussion — nothing is visible during the private
     * don-watch/sheriff-watch reveals or either night-check phase.
     */
    public function canPlayerView(MafiaPlayer $viewer, MafiaPlayer $target): bool
    {
        if ($viewer->id === $target->id) {
            return false;
        }

        // Once the game has ended, every seat's role is already fully
        // revealed (roomSnapshot()) and the alive/dead distinction stops
        // gating anything — the whole table (including eliminated
        // players) stays in view so everyone can keep talking after the
        // result is announced, not just whoever happened to survive.
        if ($this->status === 'game_over') {
            return true;
        }

        if (! $viewer->isAlive() || ! $target->isAlive()) {
            return false;
        }

        $bothBlackTeam = $viewer->team() === 'black' && $target->team() === 'black';

        return match (true) {
            in_array($this->status, ['sitdown', 'night', 'shooting'], true) => $bothBlackTeam,
            $this->status === 'day' => true,
            default => false,
        };
    }

    /**
     * A short, verbally-shareable code: uppercase only, excluding
     * characters easily confused when read aloud or handwritten
     * (O/0, I/1/L) — identical convention to RaceRoom::generateUniqueRoomCode().
     */
    public static function generateUniqueRoomCode(): string
    {
        $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

        do {
            $code = '';
            for ($i = 0; $i < 6; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
        } while (self::where('room_code', $code)->exists());

        return $code;
    }

    /**
     * Opportunistic cleanup, run on every new room creation — this app has
     * no cron scheduler wired up, mirroring RaceRoom::deleteStaleFinishedRooms().
     */
    public static function deleteStaleFinishedRooms(): int
    {
        return self::whereIn('status', ['game_over', 'cancelled'])
            ->where('updated_at', '<', now()->subHours(config('mafia.cleanup_after_hours')))
            ->delete();
    }
}
