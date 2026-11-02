<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Client accounts: made by a super admin for a streamer who uses the desktop app instead of the
 * site. No e-mail (a placeholder under .invalid, never mailed), no password, active at once; the
 * only way in is an access key the admin hands over. The app trades the key for a one-time login
 * code, opens the site with it and the account then sees only its room (RestrictClientAccounts).
 */
class ClientAccounts
{
    public const EMAIL_DOMAIN = 'clients.invalid';

    // no 0/O, 1/I/L, U: a key is read out and typed by hand
    private const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const CODE_TTL = 120;   // seconds

    public function __construct(private StreamerPack $pack) {}

    public function create(string $name, bool $streamerPack, ?User $by = null): User
    {
        $user = new User;
        $user->forceFill([
            'name' => $name,
            'email' => 'client-'.Str::lower(Str::random(16)).'@'.self::EMAIL_DOMAIN,
            'password' => Str::random(64),           // hashed by the model's cast, never known to anyone
            'email_verified_at' => now(),
            'client_only' => true,
        ])->save();

        if ($streamerPack) {
            $this->pack->grantUser($user, by: $by);
        }

        return $user;
    }

    /** a new key (shown once); the old one and every open session of the account stop working */
    public function issueKey(User $user): string
    {
        $raw = '';
        for ($i = 0; $i < 20; $i++) {
            $raw .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }
        $user->forceFill([
            'client_key_hash' => $this->hash($raw),
            'client_key_hint' => substr($raw, -4),
            'client_key_issued_at' => now(),
        ])->save();
        $this->endSessions($user);

        return 'MD-'.implode('-', str_split($raw, 4));
    }

    public function revokeKey(User $user): void
    {
        $user->forceFill(['client_key_hash' => null, 'client_key_hint' => null, 'client_key_issued_at' => null])->save();
        $this->endSessions($user);
    }

    public function userForKey(string $key): ?User
    {
        $raw = $this->normalize($key);
        if (strlen($raw) !== 20) {
            return null;
        }

        return User::where('client_only', true)->where('client_key_hash', $this->hash($raw))->first();
    }

    /** a code that signs the app's browser in once, within two minutes */
    public function loginCode(User $user): string
    {
        $code = Str::random(48);
        Cache::put('client-login:'.$code, $user->id, self::CODE_TTL);

        return $code;
    }

    public function userForCode(string $code): ?User
    {
        $id = Cache::pull('client-login:'.$code);

        return $id ? User::where('client_only', true)->whereNotNull('client_key_hash')->find($id) : null;
    }

    /** "md-abcd efgh…" as typed → "ABCDEFGH…" */
    private function normalize(string $key): string
    {
        $key = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $key));

        return str_starts_with($key, 'MD') && strlen($key) === 22 ? substr($key, 2) : $key;
    }

    private function hash(string $raw): string
    {
        return hash_hmac('sha256', $raw, (string) config('app.key'));
    }

    private function endSessions(User $user): void
    {
        $user->forceFill(['remember_token' => Str::random(60)])->save();
        if (config('session.driver') === 'database') {
            DB::table(config('session.table', 'sessions'))->where('user_id', $user->id)->delete();
        }
    }
}
