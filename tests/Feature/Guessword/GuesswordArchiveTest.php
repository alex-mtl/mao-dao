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

function journalDay(): array
{
    $l = fn ($time, $room, $msg) => "2026-10-25T{$time}+0000 ip-1 python[1]: <{$room}> {$msg}";

    return [
        $l('10:00:00', 'gw1', '[tiktok] connecting to @mao (room 111) ...'),
        $l('10:00:01', 'gw1', '[tiktok] @mao is not live yet, retry in 15s'),
        $l('10:00:20', 'gw1', '[tiktok] connecting to @mao (room 222) ...'),
        $l('10:00:22', 'gw1', '[tiktok] connected to @mao LIVE'),
        $l('10:00:30', 'gw1', '[guess] round 1 (normal, hard), secret has 7 letters, table: lambda'),
        $l('10:01:00', 'gw1', '[balloons] #1 for Ann: x (105 likes)'),
        $l('10:02:00', 'gw1', '[plane] Bob: 1002 likes -> auto plane'),
        $l('10:03:00', 'gw1', '[tiktok] disconnected'),
        $l('10:03:05', 'gw1', '[tiktok] connecting to @mao (room 222) ...'),
        $l('10:03:07', 'gw1', '[tiktok] connected to @mao LIVE'),
        $l('10:04:22', 'gw1', '[guess] round 1 exact: word=море winner=Ann: x'),
        $l('10:04:30', 'gw1', "[chat] Ann: x (@ann) follow=0 fan=0 +1s: 'ОГОНЬ!!'"),
        $l('10:04:31', 'gw1', "[chat] Bob (@bob) follow=0 fan=0 +1s: 'привет'"),
        $l('10:05:00', 'gw1', '[manual] Bob: cake'),
        $l('10:05:01', 'gw1', '[cake] тони: 5000 likes -> cake'),
        $l('10:06:00', 'gw1', '[tiktok] @mao is not live yet, retry in 15s'),
        $l('10:07:00', 'gw1', '[guess] round 2 timeout: word=x winner=-'),
        $l('10:08:00', 'gw3', '[tiktok] connecting to @zed (room 333) ...'),
        $l('10:08:02', 'gw3', '[tiktok] connected to @zed LIVE'),
        $l('10:09:00', 'gw3', '[plane] Zed: 1000 likes -> auto plane'),
    ];
}

it('rebuilds LIVE logs from the engine journal, one per TikTok LIVE, reconnects included', function () {
    $lives = app(App\Games\Guessword\Services\JournalLives::class)->parse(journalDay());

    expect(array_keys($lives))->toBe(['gw1'])      // gw3: two events, no win
        ->and(array_keys($lives['gw1']))->toBe(['2026-10-25_060022_222.jsonl']);
    $events = $lives['gw1']['2026-10-25_060022_222.jsonl'];
    expect(array_column($events, 'type'))->toBe(['live_start', 'round_start', 'balloon', 'plane', 'winner', 'fire', 'cake', 'cake'])
        ->and($events[0]['t'])->toBe('2026-10-25T06:00:22.000-04:00')
        ->and($events[4])->toMatchArray(['s' => 240.0, 'word' => 'море', 'user' => ['uid' => '', 'id' => '', 'name' => 'Ann: x']])
        ->and($events[2]['user']['name'])->toBe('Ann: x')
        ->and($events[6])->toMatchArray(['manual' => true]);
});

it('shows journal LIVEs in the archive unless the engine logged the same LIVE', function () {
    $user = User::factory()->create(['email' => 'streamer@example.com']);
    $room = GuesswordRoom::create(['user_id' => $user->id, 'lang' => 'ru']);
    $dir = App\Games\Guessword\Services\LiveArchive::journalDir($room->engineId());
    @mkdir($dir, 0775, true);
    $lives = app(App\Games\Guessword\Services\JournalLives::class)->parse(journalDay());
    $events = $lives['gw1']['2026-10-25_060022_222.jsonl'];
    file_put_contents($dir.'/2026-10-25_060022_222.jsonl', implode("\n", array_map('json_encode', $events))."\n");
    file_put_contents($dir.'/2026-10-30_064810_7.jsonl', implode("\n", array_map('json_encode', $events))."\n");   // the engine has this one
    fakeEngine();

    try {
        $this->actingAs($user)->get('/guessword/archive')->assertInertia(fn ($p) => $p
            ->has('lives', 2)
            ->where('lives.0.journal', false)
            ->where('lives.1.file', '2026-10-25_060022_222.jsonl')
            ->where('lives.1.journal', true)
            ->where('lives.1.wins', 1)
            ->where('lives.1.cakes', 2)
            ->where('lives.1.champion.name', 'Ann: x'));
        $this->actingAs($user)->getJson('/guessword/archive/lives/2026-10-25_060022_222.jsonl')->assertOk()->assertJsonCount(8);
    } finally {
        array_map('unlink', glob($dir.'/*'));
        @rmdir($dir);
    }
});
