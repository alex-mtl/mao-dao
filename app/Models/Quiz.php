<?php

namespace App\Models;

use Database\Factories\QuizFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'user_id', 'title', 'description', 'language', 'status',
    'published_at', 'allow_copying', 'copied_from_quiz_id', 'estimated_minutes',
])]
class Quiz extends Model
{
    /** @use HasFactory<QuizFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            'allow_copying' => 'boolean',
            'published_at' => 'datetime',
        ];
    }

    public function scopePublished(Builder $query): Builder
    {
        return $query->where('status', 'published');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function questions(): HasMany
    {
        return $this->hasMany(Question::class)->orderBy('order');
    }

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class);
    }

    public function copiedFrom(): BelongsTo
    {
        return $this->belongsTo(Quiz::class, 'copied_from_quiz_id');
    }

    public function copies(): HasMany
    {
        return $this->hasMany(Quiz::class, 'copied_from_quiz_id');
    }

    public function attempts(): HasMany
    {
        return $this->hasMany(QuizAttempt::class);
    }

    public function likes(): HasMany
    {
        return $this->hasMany(QuizLike::class);
    }

    public function raceRooms(): HasMany
    {
        return $this->hasMany(RaceRoom::class);
    }

    public function isPublished(): bool
    {
        return $this->status === 'published';
    }
}
