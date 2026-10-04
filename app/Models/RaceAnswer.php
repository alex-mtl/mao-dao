<?php

namespace App\Models;

use Database\Factories\RaceAnswerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['race_player_id', 'question_id', 'answer_id', 'is_correct', 'response_time_ms', 'points'])]
class RaceAnswer extends Model
{
    /** @use HasFactory<RaceAnswerFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            'is_correct' => 'boolean',
        ];
    }

    public function player(): BelongsTo
    {
        return $this->belongsTo(RacePlayer::class, 'race_player_id');
    }

    public function question(): BelongsTo
    {
        return $this->belongsTo(Question::class);
    }

    public function answer(): BelongsTo
    {
        return $this->belongsTo(Answer::class);
    }
}
