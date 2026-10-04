<?php

namespace App\Console\Commands;

use App\Services\Mafia\MafiaTickService;
use Illuminate\Console\Command;

/**
 * Supervised long-running process (see docker-compose.yml's future
 * `mafia-tick` service, and the PM2 process on production) — the thin
 * loop wrapper around MafiaTickService, which holds the actual,
 * directly-testable advancement logic. Mirrors RaceTick exactly.
 */
class MafiaTick extends Command
{
    protected $signature = 'mafia:tick';

    protected $description = 'Continuously advance Mafia Room state machines whose server-side deadlines have passed';

    public function handle(MafiaTickService $tickService): int
    {
        $this->info('mafia:tick running (Ctrl+C to stop)...');

        while (true) {
            $tickService->tick();
            usleep(500_000);
        }
    }
}
