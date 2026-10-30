<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\StreamerPack;
use Illuminate\Console\Command;

/**
 * Turns the "streamer pack" on/off for a user by hand (the rules live in StreamerPack):
 *
 *   php artisan streamer grant user@example.com
 *   php artisan streamer revoke user@example.com
 *   php artisan streamer list
 */
class Streamer extends Command
{
    protected $signature = 'streamer
        {action : grant | revoke | list}
        {email? : the user\'s e-mail}
        {--force : grant even if no user has this e-mail yet}';

    protected $description = 'Turn the streamer pack on/off for a user, or list who has it';

    public function handle(StreamerPack $pack): int
    {
        $action = $this->argument('action');
        $email = strtolower(trim((string) $this->argument('email')));

        if ($action === 'list') {
            $emails = $pack->emails();
            foreach ($emails as $e) {
                $this->line($e.'  '.$this->describe($this->findUser($e)));
            }
            $this->info(count($emails).' streamer(s); super admins have the pack anyway.');

            return self::SUCCESS;
        }

        if (! in_array($action, ['grant', 'revoke'], true) || $email === '') {
            $this->error('Usage: streamer grant|revoke <email>  or  streamer list');

            return self::FAILURE;
        }

        $user = $this->findUser($email);
        $who = $email.'  '.$this->describe($user);

        if ($action === 'grant') {
            if (! $user && ! $this->option('force')) {
                $this->error("No user with e-mail {$email} (use --force to add it anyway).");

                return self::FAILURE;
            }
            $this->info($pack->grant($email) ? "Granted: {$who}" : "Already has the pack: {$who}");
        } else {
            $this->info($pack->revoke($email) ? "Revoked: {$who}" : "Did not have the pack: {$who}");
        }

        return self::SUCCESS;
    }

    private function findUser(string $email): ?User
    {
        return User::whereRaw('lower(email) = ?', [$email])->first();
    }

    private function describe(?User $user): string
    {
        return $user ? "(id {$user->id}, {$user->name})" : '(no such user)';
    }
}
