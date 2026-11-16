<?php

declare(strict_types=1);

namespace App\Games\Guessword\Console;

use App\Games\Guessword\Models\GuesswordSpeechJob;
use App\Games\Guessword\Services\SpeechJobs;
use Illuminate\Console\Command;

/**
 * Runs the "get the markup" jobs of the archive one after another (PM2 process quiz-speech-worker):
 *
 *   php artisan guessword:speech-worker [--once]
 *
 * One job at a time: the Kaggle kernel is one slot and the box is shared. A stage that waits for Kaggle is checked once a minute.
 */
class SpeechWorkerCommand extends Command
{
    protected $signature = 'guessword:speech-worker {--once : do one stage of one job and leave}';

    protected $description = 'Run the archive\'s "get the markup" jobs (sound, Kaggle, speech import)';

    public function handle(SpeechJobs $jobs): int
    {
        do {
            $job = GuesswordSpeechJob::whereIn('status', GuesswordSpeechJob::ACTIVE)->orderBy('id')->first();
            if ($job) {
                $this->line("job {$job->id} ({$job->live_key}): {$job->status}");
                $jobs->step($job);
                $job->refresh();
                $this->line("  -> {$job->status} {$job->note}{$job->error}");
            }
            if ($this->option('once')) {
                break;
            }
            sleep($job && $job->status === 'kaggle' ? 60 : 5);
        } while (true);

        return self::SUCCESS;
    }
}
