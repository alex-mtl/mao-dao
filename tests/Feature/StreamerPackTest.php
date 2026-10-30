<?php

use App\Models\User;
use App\Services\Capabilities;
use App\Services\StreamerPack;

beforeEach(function () {
    // the command edits .env: point the app at a throw-away copy
    $this->envDir = sys_get_temp_dir().'/streamer-pack-'.uniqid();
    mkdir($this->envDir);
    file_put_contents($this->envDir.'/.env', "APP_NAME=Test\nGUESSWORD_STREAMERS=old@example.com\nAPP_DEBUG=true\n");
    app()->useEnvironmentPath($this->envDir);
});

afterEach(function () {
    @unlink($this->envDir.'/.env');
    @rmdir($this->envDir);
});

it('grants and revokes the pack and keeps the rest of .env', function () {
    $user = User::factory()->create(['email' => 'New@Example.com']);

    $this->artisan('streamer', ['action' => 'grant', 'email' => 'new@example.com'])->assertSuccessful();

    expect(file_get_contents($this->envDir.'/.env'))
        ->toBe("APP_NAME=Test\nGUESSWORD_STREAMERS=old@example.com,new@example.com\nAPP_DEBUG=true\n")
        ->and(app(Capabilities::class)->allows($user, Capabilities::GUESSWORD_TIKTOK))->toBeTrue();

    $this->artisan('streamer', ['action' => 'grant', 'email' => 'NEW@example.com'])
        ->expectsOutputToContain('Already has the pack')->assertSuccessful();

    $this->artisan('streamer', ['action' => 'revoke', 'email' => 'new@example.com'])->assertSuccessful();

    expect(app(StreamerPack::class)->emails())->toBe(['old@example.com'])
        ->and(app(Capabilities::class)->allows($user, Capabilities::GUESSWORD_TIKTOK))->toBeFalse();
});

it('refuses an unknown e-mail unless forced', function () {
    $this->artisan('streamer', ['action' => 'grant', 'email' => 'ghost@example.com'])->assertFailed();
    expect(app(StreamerPack::class)->has('ghost@example.com'))->toBeFalse();

    $this->artisan('streamer', ['action' => 'grant', 'email' => 'ghost@example.com', '--force' => true])->assertSuccessful();
    expect(app(StreamerPack::class)->has('ghost@example.com'))->toBeTrue();
});

it('adds the line when .env has none', function () {
    file_put_contents($this->envDir.'/.env', "APP_NAME=Test\n");

    app(StreamerPack::class)->grant('a@example.com');

    expect(file_get_contents($this->envDir.'/.env'))->toBe("APP_NAME=Test\nGUESSWORD_STREAMERS=a@example.com\n");
});
