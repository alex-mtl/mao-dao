<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\StreamerPack;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * Turns the "streamer pack" on/off for a user by hand (the rules live in StreamerPack):
 *
 *   php artisan streamer grant user@example.com
 *   php artisan streamer grant SomeNick --until=2027-03-31   (the user's name; must match exactly one user)
 *   php artisan streamer revoke user@example.com|SomeNick
 *   php artisan streamer list
 */
class Streamer extends Command
{
    protected $signature = 'streamer
        {action : grant | revoke | list}
        {user? : the user\'s e-mail or nickname}
        {--until= : last day of the pack, YYYY-MM-DD (default: the end of 2026)}';

    protected $description = 'Turn the streamer pack on/off for a user, or list who has it';

    public function handle(StreamerPack $pack): int
    {
        $action = $this->argument('action');
        $given = trim((string) $this->argument('user'));

        if ($action === 'list') {
            $holders = $pack->holders();
            foreach ($holders as $grant) {
                $this->line($grant->user->email.'  '.$this->describe($grant->user).'  until '.($grant->expires_at?->toDateString() ?? 'no end'));
            }
            $this->info($holders->count().' streamer(s); super admins have the pack anyway.');

            return self::SUCCESS;
        }

        if (! in_array($action, ['grant', 'revoke'], true) || $given === '') {
            $this->error('Usage: streamer grant|revoke <email|nickname> [--until=YYYY-MM-DD]  or  streamer list');

            return self::FAILURE;
        }

        $user = User::whereRaw('lower(email) = ?', [strtolower($given)])->first();
        if (! $user) {
            $byName = User::whereRaw('lower(name) = ?', [mb_strtolower($given)])->get();
            if ($byName->count() > 1) {
                $this->error("Several users are called \"{$given}\" — use the e-mail:");
                foreach ($byName as $u) {
                    $this->line('  '.$u->email.'  '.$this->describe($u));
                }

                return self::FAILURE;
            }
            $user = $byName->first();
        }
        if (! $user) {
            $this->error("No user with e-mail or nickname \"{$given}\".");

            return self::FAILURE;
        }

        $who = $user->email.'  '.$this->describe($user);

        if ($action === 'grant') {
            $until = $this->option('until') ? Carbon::parse($this->option('until'))->endOfDay() : null;
            $done = $pack->grantUser($user, $until, 'console');
            $end = $pack->activeFor($user)?->expires_at?->toDateString() ?? 'no end';
            $this->info(($done ? 'Granted: ' : 'Already has the pack: ').$who.'  until '.$end);
        } else {
            $this->info($pack->revokeUser($user) ? "Revoked: {$who}" : "Did not have the pack: {$who}");
        }

        return self::SUCCESS;
    }

    private function describe(User $user): string
    {
        return "(id {$user->id}, {$user->name})";
    }
}
