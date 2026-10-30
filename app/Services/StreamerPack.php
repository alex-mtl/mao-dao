<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\Facades\Artisan;

/**
 * Who has the "streamer pack" (CLAUDE.md, "Repository layout and code boundaries", rule 3).
 * The one place that grants / revokes it: the `streamer` artisan command today, the site's
 * purchase flow later. For the pilot the pack is the GUESSWORD_STREAMERS allowlist in .env
 * (read by Capabilities via config('guessword.streamers')); moving it to a table later only
 * changes this class.
 */
class StreamerPack
{
    private const KEY = 'GUESSWORD_STREAMERS';

    public function __construct(private Application $app) {}

    /** @return list<string> lower-cased e-mails */
    public function emails(): array
    {
        $value = preg_match('/^'.self::KEY.'=(.*)$/m', $this->env(), $m) ? trim($m[1], " \t\r\"'") : '';

        return array_values(array_unique(array_filter(array_map(
            fn ($e) => strtolower(trim($e)),
            explode(',', $value),
        ))));
    }

    public function has(string $email): bool
    {
        return in_array(strtolower(trim($email)), $this->emails(), true);
    }

    /** @return bool false if the e-mail already had the pack */
    public function grant(string $email): bool
    {
        $email = strtolower(trim($email));
        $list = $this->emails();
        if (in_array($email, $list, true)) {
            return false;
        }
        $list[] = $email;
        $this->save($list);

        return true;
    }

    /** @return bool false if the e-mail did not have the pack */
    public function revoke(string $email): bool
    {
        $email = strtolower(trim($email));
        $list = $this->emails();
        if (! in_array($email, $list, true)) {
            return false;
        }
        $this->save(array_values(array_diff($list, [$email])));

        return true;
    }

    /** @param list<string> $list */
    private function save(array $list): void
    {
        $env = $this->env();
        $line = self::KEY.'='.implode(',', $list);
        $pattern = '/^'.self::KEY.'=.*$/m';

        $env = preg_match($pattern, $env)
            ? preg_replace($pattern, $line, $env)
            : rtrim($env, "\n")."\n".$line."\n";

        file_put_contents($this->app->environmentFilePath(), $env, LOCK_EX);

        config(['guessword.streamers' => $list]);
        if ($this->app->configurationIsCached()) {
            Artisan::call('config:cache');   // re-reads .env in a fresh app
        }
    }

    private function env(): string
    {
        $path = $this->app->environmentFilePath();

        return is_file($path) ? (string) file_get_contents($path) : '';
    }
}
