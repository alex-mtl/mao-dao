<?php

use App\Games\Guessword\Models\GuesswordRoom;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->withoutVite();
    config([
        'guessword.engine_url' => 'http://engine.test',
        'guessword.engine_secret' => 's3cret',
        'guessword.streamers' => ['streamer@example.com'],
    ]);
});

function liveLog(): string
{
    $u = fn ($uid, $name) => ['uid' => $uid, 'id' => 'id'.$uid, 'name' => $name];
    $lines = [
        ['t' => '2026-10-30T06:48:10.980-04:00', 's' => 0.0, 'type' => 'live_start', 'epoch' => 1, 'tiktok_room' => '7', 'username' => 'mao'],
        ['s' => 3.0, 'type' => 'viewer', 'user' => $u('1', 'Ann'), 'first' => true],
        ['s' => 6.0, 'type' => 'round_start', 'round' => 1, 'word' => 'песок', 'setter' => $u('9', 'X')],
        ['s' => 100.0, 'type' => 'balloon', 'user' => $u('1', 'Ann'), 'likes' => 105, 'n' => 1, 'per' => 100],
        ['s' => 200.0, 'type' => 'balloon', 'user' => $u('2', 'Bob'), 'gift' => 'Rose', 'count' => 5],
        ['s' => 250.0, 'type' => 'winner', 'round' => 1, 'user' => $u('1', 'Ann'), 'word' => 'песок'],
        ['s' => 260.0, 'type' => 'round_start', 'round' => 2, 'word' => 'море'],
        ['s' => 400.0, 'type' => 'plane', 'user' => $u('2', 'Bob'), 'likes' => 1000],
        ['s' => 500.0, 'type' => 'cake', 'user' => $u('2', 'Bob'), 'manual' => true, 'count' => 1],
        ['s' => 700.0, 'type' => 'winner', 'round' => 2, 'user' => $u('1', 'Ann 2'), 'word' => 'море'],
        ['s' => 900.5, 'type' => 'gift', 'user' => $u('2', 'Bob'), 'gift' => 'Rose', 'count' => 1, 'coins' => 1],
    ];

    return implode("\n", array_map(fn ($l) => json_encode($l, JSON_UNESCAPED_UNICODE), $lines))."\n";
}

function fakeEngine(): void
{
    Http::fake([
        'engine.test/internal/lives?*' => Http::response(['lives' => [['room' => 'gw1', 'file' => '2026-10-30_064810_7.jsonl', 'size' => 999, 'mtime' => 1]]]),
        'engine.test/internal/lives/*' => Http::response(liveLog()),
        'engine.test/internal/avatars/1' => Http::response('JPEGDATA', 200, ['Content-Type' => 'image/jpeg']),
        'engine.test/internal/avatars/*' => Http::response('', 404),
    ]);
}

it('lists the streamer\'s lives with counts, champion and activity bins', function () {
    fakeEngine();
    $user = User::factory()->create(['email' => 'streamer@example.com']);

    $this->actingAs($user)->get('/guessword/archive')->assertOk()->assertInertia(fn ($p) => $p
        ->component('Guessword/Archive')
        ->where('engineOnline', true)
        ->has('lives', 1)
        ->where('lives.0.file', '2026-10-30_064810_7.jsonl')
        ->where('lives.0.date', '2026-10-30')
        ->where('lives.0.duration', 901)
        ->where('lives.0.rounds', 2)
        ->where('lives.0.wins', 2)
        ->where('lives.0.planes', 1)
        ->where('lives.0.balloons', 6)
        ->where('lives.0.cakes', 1)
        ->where('lives.0.champion.wins', 2)
        ->where('lives.0.champion.name', 'Ann 2')
        ->has('lives.0.bins', 4)
        ->where('lives.0.bins.0', ['w' => 1, 'b' => 6, 'p' => 0, 'c' => 0]));
});

it('gives the digest only its event types, users cut to uid / id / name', function () {
    fakeEngine();
    $user = User::factory()->create(['email' => 'streamer@example.com']);

    $events = $this->actingAs($user)->getJson('/guessword/archive/lives/2026-10-30_064810_7.jsonl')->assertOk()->json();
    expect(collect($events)->pluck('type')->unique()->values()->all())
        ->toBe(['live_start', 'round_start', 'balloon', 'winner', 'plane', 'cake'])
        ->and($events[2])->not->toHaveKey('setter');

    $this->actingAs($user)->getJson('/guessword/archive/lives/other.jsonl')->assertNotFound();
    $this->actingAs($user)->getJson('/guessword/archive/lives/..%2Fx.jsonl')->assertNotFound();
});

it('serves avatars from the engine and keeps the archive from non-streamers', function () {
    fakeEngine();
    $user = User::factory()->create(['email' => 'streamer@example.com']);
    $this->actingAs($user)->get('/guessword/avatars/1')->assertOk()->assertHeader('Content-Type', 'image/jpeg');
    $this->actingAs($user)->get('/guessword/avatars/5')->assertNotFound();

    $plain = User::factory()->create();
    $this->actingAs($plain)->get('/guessword/archive')->assertForbidden();
    $this->actingAs($plain)->get('/guessword/avatars/1')->assertForbidden();
    $room = GuesswordRoom::create(['user_id' => $user->id, 'lang' => 'ru']);
    $this->actingAs($plain)->get('/guessword/rooms/'.$room->id.'/archive')->assertForbidden();

    $admin = User::factory()->create();
    $admin->role()->associate(Role::factory()->create(['slug' => Role::SUPER_ADMIN]))->save();
    $this->actingAs($admin)->get('/guessword/rooms/'.$room->id.'/archive')->assertOk()
        ->assertInertia(fn ($p) => $p->where('room.foreign', $user->name));
});
