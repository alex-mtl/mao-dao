<?php

declare(strict_types=1);

namespace App\Games\Guessword\Models;

use Illuminate\Database\Eloquent\Model;

/** The host's words of one LIVE (guessword_speech; App\Games\Guessword\Services\SpeechArchive) */
class GuesswordSpeech extends Model
{
    protected $table = 'guessword_speech';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['words' => 'array'];
    }
}
