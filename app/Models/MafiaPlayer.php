<?php

namespace App\Models;

use Database\Factories\MafiaPlayerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'mafia_room_id', 'user_id', 'slot', 'role', 'status', 'warnings',
    'is_ready', 'is_game_host', 'connection_status', 'last_seen_at',
    'disconnected_at', 'joined_at',
])]
class MafiaPlayer extends Model
{
    /** @use HasFactory<MafiaPlayerFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            'is_ready' => 'boolean',
            'is_game_host' => 'boolean',
            'last_seen_at' => 'datetime',
            'disconnected_at' => 'datetime',
            'joined_at' => 'datetime',
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

    public function actions(): HasMany
    {
        return $this->hasMany(MafiaAction::class, 'actor_player_id');
    }

    /**
     * A seat nobody joined — still dealt a role and still alive/dead for
     * every game-engine purpose, it just never speaks or acts. See the
     * mafia_players migration and MafiaRoom::checkWinner().
     */
    public function isDummy(): bool
    {
        return $this->user_id === null;
    }

    public function team(): ?string
    {
        return $this->role ? config("mafia.teams.{$this->role}") : null;
    }

    public function isAlive(): bool
    {
        return $this->status === 'alive';
    }
}
