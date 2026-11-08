<?php

namespace App\Models;

use Database\Factories\QuestionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['quiz_id', 'text', 'order', 'wrong_pool'])]
class Question extends Model
{
    /** @use HasFactory<QuestionFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            // every generated wrong answer (services/quiz-factory); the 3 in answers are a pick from it
            'wrong_pool' => 'array',
        ];
    }

    public function quiz(): BelongsTo
    {
        return $this->belongsTo(Quiz::class);
    }

    public function answers(): HasMany
    {
        return $this->hasMany(Answer::class)->orderBy('order');
    }

    public function correctAnswer(): ?Answer
    {
        return $this->answers->firstWhere('is_correct', true);
    }
}
