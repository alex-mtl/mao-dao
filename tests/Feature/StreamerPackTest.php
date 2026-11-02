<?php

use App\Models\User;
use App\Models\UserProduct;
use App\Services\Capabilities;
use App\Services\StreamerPack;
use Illuminate\Support\Carbon;

afterEach(fn () => Carbon::setTestNow());

it('grants and revokes the pack from the console, keeping every grant as history', function () {
    $user = User::factory()->create(['email' => 'New@Example.com']);
    $caps = app(Capabilities::class);

    $this->artisan('streamer', ['action' => 'grant', 'user' => 'new@example.com'])
        ->expectsOutputToContain('until 2026-12-31')->assertSuccessful();
    expect($caps->allows($user, Capabilities::GUESSWORD_TIKTOK))->toBeTrue();

    $this->artisan('streamer', ['action' => 'grant', 'user' => 'NEW@example.com'])
        ->expectsOutputToContain('Already has the pack')->assertSuccessful();

    // a longer term replaces the shorter one
    $this->artisan('streamer', ['action' => 'grant', 'user' => 'new@example.com', '--until' => '2027-03-31'])
        ->expectsOutputToContain('until 2027-03-31')->assertSuccessful();

    $this->artisan('streamer', ['action' => 'list'])->expectsOutputToContain('New@Example.com')->assertSuccessful();

    $this->artisan('streamer', ['action' => 'revoke', 'user' => 'new@example.com'])->assertSuccessful();
    expect($caps->allows($user, Capabilities::GUESSWORD_TIKTOK))->toBeFalse()
        ->and(UserProduct::where('user_id', $user->id)->count())->toBe(2)
        ->and(UserProduct::active()->count())->toBe(0);
});

it('ends the pack on its expiry date', function () {
    $user = User::factory()->create();
    app(StreamerPack::class)->grantUser($user, Carbon::parse('2026-12-31 23:59:59'));

    Carbon::setTestNow('2026-12-31 23:00:00');
    expect(app(StreamerPack::class)->hasUser($user))->toBeTrue();

    Carbon::setTestNow('2027-01-01 00:00:01');
    expect(app(StreamerPack::class)->hasUser($user))->toBeFalse();
});

it('refuses an unknown user and finds one by nickname, refusing an ambiguous one', function () {
    $this->artisan('streamer', ['action' => 'grant', 'user' => 'ghost@example.com'])->assertFailed();

    $user = User::factory()->create(['name' => 'StreamStar', 'email' => 'Star@Example.com']);
    $this->artisan('streamer', ['action' => 'grant', 'user' => 'streamstar'])
        ->expectsOutputToContain('Granted: Star@Example.com')->assertSuccessful();
    expect(app(StreamerPack::class)->hasUser($user))->toBeTrue();

    User::factory()->create(['name' => 'streamstar', 'email' => 'other@example.com']);
    $this->artisan('streamer', ['action' => 'grant', 'user' => 'StreamStar'])
        ->expectsOutputToContain('Several users')->assertFailed();
});
