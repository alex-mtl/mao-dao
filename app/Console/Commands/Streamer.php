<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\StreamerPack;
use Illuminate\Console\Command;

/**
 * Turns the "streamer pack" on/off for a user by hand (the rules live in StreamerPack):
 *
 *   php artisan streamer grant user@example.com
 *   php artisan streamer grant SomeNick          (the user's name; must match exactly one user)
 *   php artisan streamer revoke user@example.com|SomeNick
 *   php artisan streamer list
 */
class Streamer extends Command
{
    protected $signature = 'streamer
        {action : grant | revoke | list}
        {user? : the user\'s e-mail or nickname}
        {--force : grant even if no user has this e-mail yet}';

    protected $description = 'Turn the streamer pack on/off for a user, or list who has it';

    public function handle(StreamerPack $pack): int
    {
        $action = $this->argument('action');
        $given = trim((string) $this->argument('user'));

        if ($action === 'list') {
            $emails = $pack->emails();
            foreach ($emails as $e) {
                $this->line($e.'  '.$this->describe($this->findUser($e)));
            }
            $this->info(count($emails).' streamer(s); super admins have the pack anyway.');

            return self::SUCCESS;
        }

        if (! in_array($action, ['grant', 'revoke'], true) || $given === '') {
            $this->error('Usage: streamer grant|revoke <email|nickname>  or  streamer list');

            return self::FAILURE;
        }

        $email = strtolower($given);
        $user = $this->findUser($email);

        if (! $user) {
            $byName = User::whereRaw('lower(name) = ?', [mb_strtolower($given)])->get();
            if ($byName->count() > 1) {
                $this->error("Several users are called \"{$given}\" — use the e-mail:");
                foreach ($byName as $u) {
                    $this->line('  '.$u->email.'  '.$this->describe($u));
                }

                return self::FAILURE;
            }
            if ($user = $byName->first()) {
                $email = strtolower($user->email);
            }
        }

        $who = $email.'  '.$this->describe($user);

        if ($action === 'grant') {
            if (! $user && (! $this->option('force') || ! str_contains($email, '@'))) {
                $this->error("No user with e-mail or nickname \"{$given}\" (--force adds an unregistered e-mail).");

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
