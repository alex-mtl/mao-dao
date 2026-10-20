<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;

/**
 * Platform-level answers to "may this user do X?" (CLAUDE.md, "Repository layout and code
 * boundaries", rule 3). Games only ask; the rules live here, so the planned game currency /
 * "streamer pack" can replace a pilot allowlist without touching any game.
 */
class Capabilities
{
    /** Guess the Word: run the game for one's own TikTok LIVE. */
    public const GUESSWORD_TIKTOK = 'guessword.tiktok';

    public function allows(?User $user, string $capability): bool
    {
        if (! $user) {
            return false;
        }

        return match ($capability) {
            self::GUESSWORD_TIKTOK => $user->isSuperAdmin()
                || in_array(strtolower((string) $user->email), config('guessword.streamers', []), true),
            default => false,
        };
    }
}
