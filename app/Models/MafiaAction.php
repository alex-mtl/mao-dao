<?php

namespace App\Models;

use Database\Factories\MafiaActionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['mafia_room_id', 'day', 'phase', 'actor_player_id', 'target_player_id', 'action_type', 'value'])]
class MafiaAction extends Model
{
    /** @use HasFactory<MafiaActionFactory> */
    use HasFactory;

    // Append-only log — rows are never mutated after creation, so there's
    // no updated_at column to maintain (see the mafia_actions migration).
    const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'value' => 'array',
        ];
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(MafiaRoom::class, 'mafia_room_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(MafiaPlayer::class, 'actor_player_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(MafiaPlayer::class, 'target_player_id');
    }
}
