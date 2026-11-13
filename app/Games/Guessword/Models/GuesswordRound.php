<?php

declare(strict_types=1);

namespace App\Games\Guessword\Models;

use Illuminate\Database\Eloquent\Model;

/** One round of a LIVE (guessword_rounds; App\Games\Guessword\Services\RoundsArchive) */
class GuesswordRound extends Model
{
    protected $table = 'guessword_rounds';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'live_date' => 'date:Y-m-d',
            'live_started_at' => 'datetime',
            'started_at' => 'datetime',
            'offset_s' => 'float',
            'recording_s' => 'float',
            'moments' => 'array',
        ];
    }
}
