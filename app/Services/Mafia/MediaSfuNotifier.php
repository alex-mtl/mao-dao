<?php

namespace App\Services\Mafia;

use App\Models\MafiaRoom;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Tells the media-sfu sidecar to re-read a room's mic policy immediately
 * (see MafiaRoom::micPolicy()) after something that changes who may be
 * heard: a phase/stage change, the game starting or ending. Best-effort by
 * design — the sidecar also polls once a second, so a failed nudge only
 * costs up to a second of latency, never correctness — and it must never
 * be able to break or slow a game transition.
 */
class MediaSfuNotifier
{
    public function refreshMics(MafiaRoom $room): void
    {
        $base = config('mafia.media_internal_url');
        if (blank($base)) {
            return;
        }

        try {
            Http::withHeaders(['X-Media-Sfu-Secret' => (string) config('mafia.media_shared_secret')])
                ->connectTimeout(1)
                ->timeout(1)
                ->post(rtrim($base, '/').'/internal/refresh-mics', ['room' => $room->room_code]);
        } catch (Throwable) {
            // Sidecar down or slow — the 1s poll will catch up.
        }
    }
}
