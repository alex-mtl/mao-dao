<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One grant of a product to an account, with its term (granted by hand today, bought later).
 * Active = started, not expired, not revoked; old rows are the account's history.
 */
class UserProduct extends Model
{
    public const STREAMER_PACK = 'streamer_pack';

    protected $fillable = ['user_id', 'product', 'starts_at', 'expires_at', 'revoked_at', 'source', 'granted_by'];

    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'expires_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->whereNull('revoked_at')
            ->where('starts_at', '<=', now())
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()));
    }
}
