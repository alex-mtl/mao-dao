<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Someone watching a Mafia room without a seat — a registered user, or a
 * guest identified only by a token in their session. Not a player: has no
 * role, never counts towards the game, cannot act. See
 * MafiaRoom::canSpectatorView() for what they may see and hear.
 */
#[Fillable(['mafia_room_id', 'user_id', 'session_token', 'last_seen_at'])]
class MafiaSpectator extends Model
{
    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
        ];
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(MafiaRoom::class, 'mafia_room_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Still around: seen recently enough to count as present. */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('last_seen_at', '>=', now()->subSeconds(config('mafia.spectator_active_seconds')));
    }

    /**
     * The id the media sidecar knows this viewer by. Prefixed so it can
     * never collide with a numeric player id.
     */
    public function mediaId(): string
    {
        return 's'.$this->id;
    }
}
