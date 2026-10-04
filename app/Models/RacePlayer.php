<?php

namespace App\Models;

use Database\Factories\RacePlayerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'race_room_id', 'user_id', 'nickname', 'session_token', 'is_host',
    'score', 'joined_at', 'last_seen_at', 'disconnected_at',
])]
class RacePlayer extends Model
{
    /** @use HasFactory<RacePlayerFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            'is_host' => 'boolean',
            'joined_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'disconnected_at' => 'datetime',
        ];
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(RaceRoom::class, 'race_room_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function answers(): HasMany
    {
        return $this->hasMany(RaceAnswer::class);
    }
}
