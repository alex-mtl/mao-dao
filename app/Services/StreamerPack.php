<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;
use App\Models\UserProduct;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Who has the "streamer pack" (CLAUDE.md, "Repository layout and code boundaries", rule 3): an
 * active row of the account's products (App\Models\UserProduct). The one place that grants /
 * revokes it: the `streamer` artisan command and the client accounts page today, the site's
 * purchase flow later. Super admins have it anyway (Capabilities).
 */
class StreamerPack
{
    // until the pack is sold, every grant runs to the end of 2026 (owner's decision, 2026-11-02)
    public const DEFAULT_UNTIL = '2026-12-31 23:59:59';

    public function hasUser(User $user): bool
    {
        return $this->activeFor($user) !== null;
    }

    /** the active grant, or null */
    public function activeFor(User $user): ?UserProduct
    {
        return UserProduct::active()->where('user_id', $user->id)->where('product', UserProduct::STREAMER_PACK)
            ->orderByRaw('expires_at is null desc')->orderByDesc('expires_at')->first();
    }

    /**
     * Gives the pack until $until (default DEFAULT_UNTIL). An active grant that ends later is left
     * alone; a shorter one is closed and replaced, so the history shows every change.
     *
     * @return bool false if the user already had the pack at least that long
     */
    public function grantUser(User $user, ?CarbonInterface $until = null, string $source = 'admin', ?User $by = null): bool
    {
        $until ??= Carbon::parse(self::DEFAULT_UNTIL);
        $current = $this->activeFor($user);
        if ($current && ($current->expires_at === null || $current->expires_at->gte($until))) {
            return false;
        }
        $current?->update(['revoked_at' => now()]);

        UserProduct::create([
            'user_id' => $user->id,
            'product' => UserProduct::STREAMER_PACK,
            'starts_at' => now(),
            'expires_at' => $until,
            'source' => $source,
            'granted_by' => $by?->id,
        ]);

        return true;
    }

    /** @return bool false if the user did not have the pack */
    public function revokeUser(User $user): bool
    {
        return UserProduct::active()->where('user_id', $user->id)->where('product', UserProduct::STREAMER_PACK)
            ->update(['revoked_at' => now()]) > 0;
    }

    /** @return Collection<int, UserProduct> active grants with their users */
    public function holders(): Collection
    {
        return UserProduct::active()->where('product', UserProduct::STREAMER_PACK)->with('user')->orderBy('user_id')->get();
    }
}
