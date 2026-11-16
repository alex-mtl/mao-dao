<?php

declare(strict_types=1);

namespace App\Games\Guessword\Models;

use Illuminate\Database\Eloquent\Model;

/** One "get the markup" run of a LIVE (guessword_speech_jobs; App\Games\Guessword\Services\SpeechJobs) */
class GuesswordSpeechJob extends Model
{
    public const ACTIVE = ['queued', 'audio', 'kaggle', 'import'];

    protected $table = 'guessword_speech_jobs';

    protected $guarded = ['id'];

    protected $hidden = ['m3u8'];

    protected function casts(): array
    {
        return ['kaggle_pushed_at' => 'datetime'];
    }

    public function sid(): string
    {
        return 'job'.$this->id;
    }
}
