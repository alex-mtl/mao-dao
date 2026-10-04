<?php

namespace App\Models;

use Database\Factories\RaceRoomFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'quiz_id', 'host_user_id', 'room_code', 'status', 'question_order',
    'current_question_index', 'current_question_started_at', 'current_question_deadline_at',
    'results_reveal_until', 'max_players', 'started_at', 'finished_at',
])]
class RaceRoom extends Model
{
    /** @use HasFactory<RaceRoomFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            'question_order' => 'array',
            'current_question_started_at' => 'datetime',
            'current_question_deadline_at' => 'datetime',
            'results_reveal_until' => 'datetime',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function quiz(): BelongsTo
    {
        return $this->belongsTo(Quiz::class);
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(User::class, 'host_user_id');
    }

    public function players(): HasMany
    {
        return $this->hasMany(RacePlayer::class);
    }

    public function isJoinable(): bool
    {
        return $this->status === 'lobby' && $this->players()->count() < $this->max_players;
    }

    public function isFull(): bool
    {
        return $this->players()->count() >= $this->max_players;
    }

    /**
     * The question at the room's current index within its snapshotted
     * `question_order` — not the quiz's live question list, so a later
     * edit to the quiz can't shift questions mid-race.
     */
    public function currentQuestion(): ?Question
    {
        $questionId = $this->question_order[$this->current_question_index] ?? null;

        return $questionId ? Question::with('answers')->find($questionId) : null;
    }

    /**
     * Server-authoritative leaderboard: highest score first, earliest
     * join breaking ties. Never derived from anything client-supplied.
     */
    public function leaderboard(): array
    {
        return $this->players()
            ->orderByDesc('score')
            ->orderBy('joined_at')
            ->get(['id', 'nickname', 'is_host', 'score'])
            ->map(fn ($player) => [
                'id' => $player->id,
                'nickname' => $player->nickname,
                'isHost' => $player->is_host,
                'score' => $player->score,
            ])
            ->values()
            ->all();
    }

    /**
     * A short, verbally-shareable code: uppercase only, and excludes
     * characters that are easily confused when read aloud or handwritten
     * (O/0, I/1/L).
     */
    public static function generateUniqueRoomCode(): string
    {
        $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

        do {
            $code = '';
            for ($i = 0; $i < 6; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
        } while (self::where('room_code', $code)->exists());

        return $code;
    }

    /**
     * Opportunistic cleanup, run on every new room creation — this app
     * has no cron scheduler wired up (see CLAUDE.md), so relying solely
     * on a scheduled `race:cleanup` run isn't guaranteed to happen. A
     * plain indexed delete on `status`/`updated_at` is cheap enough to
     * run unconditionally at this app's scale rather than sampling it.
     */
    public static function deleteStaleFinishedRooms(): int
    {
        return self::whereIn('status', ['finished', 'cancelled'])
            ->where('updated_at', '<', now()->subHours(config('race.cleanup_after_hours')))
            ->delete();
    }
}
