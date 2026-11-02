<?php

use App\Games\Guessword\Models\GuesswordRoom;
use App\Models\Role;
use App\Models\User;
use App\Services\ClientAccounts;
use App\Services\StreamerPack;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->withoutVite();
    config([
        'guessword.engine_url' => 'http://engine.test',
        'guessword.engine_secret' => 's3cret',
    ]);
    Http::fake(['engine.test/*' => Http::response(['rooms' => []])]);
});

function clientAdmin(): User
{
    $admin = User::factory()->create();
    $admin->role()->associate(Role::factory()->create(['slug' => Role::SUPER_ADMIN]))->save();

    return $admin;
}

it('lets only a super admin create a client and issue its key, shown once', function () {
    $this->actingAs(User::factory()->create())->get('/guessword/clients')->assertForbidden();

    $admin = clientAdmin();
    $this->actingAs($admin)->post('/guessword/clients', ['name' => 'Streamer One', 'pack' => true])->assertRedirect();
    $client = User::where('client_only', true)->sole();

    expect($client->name)->toBe('Streamer One')
        ->and($client->email)->toEndWith('@'.ClientAccounts::EMAIL_DOMAIN)
        ->and($client->hasVerifiedEmail())->toBeTrue()
        ->and(app(StreamerPack::class)->activeFor($client))
        ->source->toBe('admin')
        ->granted_by->toBe($admin->id)
        ->expires_at->toDateString()->toBe('2026-12-31');

    $this->post("/guessword/clients/{$client->id}/key")->assertRedirect();
    $page = $this->get('/guessword/clients')->assertInertia(fn ($p) => $p
        ->component('Guessword/Clients')->where('clients.0.pack', true)->where('newKey.id', $client->id)
        ->where('clients.0.packUntil', fn ($v) => str_starts_with($v, '2026-12-31')));
    $key = $page->viewData('page')['props']['newKey']['key'];

    expect($key)->toMatch('/^MD(-[2-9A-Z]{4}){5}$/')
        ->and($client->fresh()->client_key_hash)->not->toContain(str_replace('-', '', substr($key, 3)));
    $this->get('/guessword/clients')->assertInertia(fn ($p) => $p->where('newKey', null));
});

it('signs the app in with the key, once per code, and gives the overlay link', function () {
    $client = app(ClientAccounts::class)->create('Two', true);
    $key = app(ClientAccounts::class)->issueKey($client);

    $this->postJson('/guessword/client/api/session', ['key' => 'MD-WRONG-KEY'])->assertUnauthorized();

    // typed by hand: lower case, spaces instead of dashes
    $res = $this->postJson('/guessword/client/api/session', ['key' => strtolower(str_replace('-', ' ', $key))])
        ->assertOk()->assertJsonPath('name', 'Two');
    $room = GuesswordRoom::where('user_id', $client->id)->sole();
    expect($res->json('overlayUrl'))->toBe($room->overlayUrl());

    $this->postJson('/guessword/client/api/overlay', ['key' => $key])->assertOk()->assertJsonPath('overlayUrl', $room->overlayUrl());

    $enter = parse_url($res->json('enterUrl'), PHP_URL_PATH);
    $this->get($enter)->assertRedirect('/guessword/room');
    $this->assertAuthenticatedAs($client);

    auth()->logout();
    $this->get($enter)->assertOk()->assertInertia(fn ($p) => $p->component('Guessword/ClientSignedOut'));
    $this->assertGuest();
});

it('refuses the key without the streamer pack and after a new key or a revoke', function () {
    $clients = app(ClientAccounts::class);
    $client = $clients->create('Three', false);
    $old = $clients->issueKey($client);
    $this->postJson('/guessword/client/api/session', ['key' => $old])->assertForbidden();

    $this->actingAs(clientAdmin())->post("/guessword/clients/{$client->id}/pack", ['on' => true]);
    $this->postJson('/guessword/client/api/session', ['key' => $old])->assertOk();

    $new = $clients->issueKey($client);
    $this->postJson('/guessword/client/api/session', ['key' => $old])->assertUnauthorized();
    $this->postJson('/guessword/client/api/session', ['key' => $new])->assertOk();

    $clients->revokeKey($client);
    $this->postJson('/guessword/client/api/session', ['key' => $new])->assertUnauthorized();
});

it('keeps a client account inside its room and asks for the Euler key before a start', function () {
    $client = app(ClientAccounts::class)->create('Four', true);

    $this->actingAs($client)->get('/profile')->assertRedirect('/guessword/room');
    $this->get('/quiz')->assertRedirect('/guessword/room');
    $this->post('/friends', [])->assertForbidden();

    $this->get('/guessword/room')->assertOk()->assertInertia(fn ($p) => $p
        ->where('room.client', true)->where('room.hasEulerKey', false)->where('auth.user.client_only', true)
        ->missing('auth.user.client_key_hash'));

    $this->post('/guessword/room', ['tiktok' => 'four_live', 'lang' => 'ru'])->assertRedirect();
    $this->post('/guessword/room/start')->assertSessionHas('error', __('guessword.client_euler_required'));
    Http::assertNotSent(fn ($r) => str_contains($r->url(), '/start'));
});
