<?php

namespace App\Console\Commands;

use App\Models\RaceRoom;
use Illuminate\Console\Command;

/**
 * Deletes finished/cancelled Race Rooms older than
 * config('race.cleanup_after_hours'). RaceController also runs this
 * opportunistically on every new room creation (this app has no cron
 * scheduler wired up to run a command like this automatically), but a
 * quiet app could go a long time between new races — a real cron entry
 * (`php artisan race:cleanup`, e.g. hourly) closes that gap. Not required
 * for correctness, just table hygiene.
 */
class RaceCleanup extends Command
{
    protected $signature = 'race:cleanup';

    protected $description = 'Delete old finished/cancelled Race Rooms';

    public function handle(): int
    {
        $deleted = RaceRoom::deleteStaleFinishedRooms();

        $this->info("Deleted {$deleted} stale Race Room(s).");

        return self::SUCCESS;
    }
}
