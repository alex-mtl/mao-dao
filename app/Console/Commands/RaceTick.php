<?php

namespace App\Console\Commands;

use App\Services\RaceTickService;
use Illuminate\Console\Command;

/**
 * Supervised long-running process (see docker-compose.yml's `race-tick`
 * service, and the PM2 process on production) — the thin loop wrapper
 * around RaceTickService, which holds the actual, directly-testable
 * advancement logic.
 */
class RaceTick extends Command
{
    protected $signature = 'race:tick';

    protected $description = 'Continuously advance Race Room state machines whose server-side deadlines have passed';

    public function handle(RaceTickService $tickService): int
    {
        $this->info('race:tick running (Ctrl+C to stop)...');

        while (true) {
            $tickService->tick();
            usleep(500_000);
        }
    }
}
