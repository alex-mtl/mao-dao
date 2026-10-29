<?php

use App\Games\Guessword\Models\GuesswordRoom;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->withoutVite();                 // the pages' data is under test, not the asset build
    config([
        'guessword.engine_url' => 'http://engine.test',
        'guessword.engine_secret' => 's3cret',
        'guessword.streamers' => ['streamer@example.com'],
        'guessword.bot_url' => 'http://bot.test',
        'guessword.bot_platform_secret' => 'plat',
    ]);
});

function engineRooms(array $rooms = []): array
{
    return ['rooms' => $rooms];
}

it('shows the section to everyone and the start button only to streamers', function () {
    Http::fake(['engine.test/internal/rooms' => Http::response(engineRooms())]);

    $this->get('/guessword')->assertOk()->assertInertia(fn ($p) => $p
        ->component('Guessword/Index')->where('canStart', false)->where('engineOnline', true));

    $streamer = User::factory()->create(['email' => 'streamer@example.com']);
    $this->actingAs($streamer)->get('/guessword')
        ->assertInertia(fn ($p) => $p->where('canStart', true));
});

it('lists only the rooms the engine reports as running', function () {
    $a = GuesswordRoom::create(['user_id' => User::factory()->create(['name' => 'Mao'])->id, 'lang' => 'ru']);
    $a->tiktok_username = 'mao.montreal';
    $a->save();
    GuesswordRoom::create(['user_id' => User::factory()->create()->id, 'lang' => 'ru']);
    Http::fake(['engine.test/internal/rooms' => Http::response(engineRooms([
        ['id' => $a->engineId(), 'running' => true],
    ]))]);

    $this->get('/guessword')->assertInertia(fn ($p) => $p
        ->has('games', 1)
        ->where('games.0.streamer', 'Mao')
        ->where('games.0.tiktokUrl', 'https://www.tiktok.com/@mao.montreal/live'));
});

it('says when the engine is down instead of failing', function () {
    Http::fake(['engine.test/*' => Http::response('', 500)]);

    $this->get('/guessword')->assertOk()->assertInertia(fn ($p) => $p->where('engineOnline', false));
});

it('gives every streamer only their own room, never another one', function () {
    config(['guessword.streamers' => ['a@example.com', 'b@example.com']]);
    Http::fake(['engine.test/*' => Http::response(engineRooms())]);
    $a = User::factory()->create(['email' => 'a@example.com']);
    $b = User::factory()->create(['email' => 'b@example.com']);

    $this->actingAs($a)->get('/guessword/room')->assertOk();
    $this->actingAs($b)->get('/guessword/room')->assertOk();
    $roomA = GuesswordRoom::where('user_id', $a->id)->sole();
    $roomB = GuesswordRoom::where('user_id', $b->id)->sole();

    // the page carries the streamer's own engine links only; there is no route that takes a room id
    $this->actingAs($b)->get('/guessword/room')->assertInertia(fn ($p) => $p
        ->where('room.controlUrl', $roomB->controlUrl())
        ->where('room.overlayUrl', $roomB->overlayUrl()));
    $page = $this->actingAs($b)->get('/guessword/room')->getContent();
    expect($page)->not->toContain($roomA->control_token)->not->toContain($roomA->overlay_token);
    $this->actingAs($b)->get('/guessword/room?room='.$roomA->id)
        ->assertInertia(fn ($p) => $p->where('room.controlUrl', $roomB->controlUrl()));

    // the public section page lists running games without any room link
    expect($this->get('/guessword')->getContent())->not->toContain($roomA->control_token)
        ->not->toContain($roomA->overlay_token);
});

it('lets a super admin into every room and nobody else', function () {
    Http::fake([
        'engine.test/*' => Http::response(engineRooms()),
        'bot.test/platform/games' => Http::response(['id' => 'gw1', 'game_key' => 'key-1']),
    ]);
    $streamer = User::factory()->create(['email' => 'streamer@example.com']);
    $this->actingAs($streamer)->post('/guessword/room', ['tiktok' => 'mao', 'lang' => 'ru']);
    $room = GuesswordRoom::where('user_id', $streamer->id)->sole();
    $admin = User::factory()->create();
    $admin->role()->associate(Role::factory()->create(['slug' => Role::SUPER_ADMIN]))->save();

    $this->actingAs($admin)->get('/guessword')->assertInertia(fn ($p) => $p->where('isAdmin', true));
    $this->actingAs($admin)->get('/guessword/rooms')->assertInertia(fn ($p) => $p
        ->component('Guessword/Rooms')->has('rooms', 1)->where('rooms.0.id', $room->id)->where('rooms.0.tiktok', 'mao'));
    $this->actingAs($admin)->get('/guessword/rooms/'.$room->id)->assertInertia(fn ($p) => $p
        ->component('Guessword/Room')->where('room.foreign', $streamer->name)
        ->where('room.controlUrl', $room->controlUrl()));
    $this->actingAs($admin)->post('/guessword/rooms/'.$room->id.'/start')->assertSessionHas('success');
    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/internal/rooms/'.$room->engineId().'/start'));
    $this->actingAs($admin)->post('/guessword/rooms/'.$room->id, ['tiktok' => 'mao2', 'lang' => 'en']);
    expect($room->fresh()->only('tiktok_username', 'lang'))->toBe(['tiktok_username' => 'mao2', 'lang' => 'en']);
    expect(GuesswordRoom::count())->toBe(1);                                     // the admin's visit made no room of their own

    // the streamer (with the streamer pack) and an ordinary user: not the list, not someone's room by id
    $other = User::factory()->create(['email' => 'other@example.com']);
    config(['guessword.streamers' => ['streamer@example.com', 'other@example.com']]);
    foreach ([$streamer, $other, User::factory()->create()] as $u) {
        $this->actingAs($u)->get('/guessword')->assertInertia(fn ($p) => $p->where('isAdmin', false));
        $this->actingAs($u)->get('/guessword/rooms')->assertForbidden();
        $this->actingAs($u)->get('/guessword/rooms/'.$room->id)->assertForbidden();
        $this->actingAs($u)->post('/guessword/rooms/'.$room->id.'/stop')->assertForbidden();
        $this->actingAs($u)->post('/guessword/rooms/'.$room->id.'/link')->assertForbidden();
        $this->actingAs($u)->post('/guessword/rooms/'.$room->id, ['tiktok' => 'x', 'lang' => 'ru'])->assertForbidden();
    }
    auth()->logout();
    $this->get('/guessword/rooms/'.$room->id)->assertRedirect(route('login'));
    expect($room->fresh()->tiktok_username)->toBe('mao2');
});

it('keeps the room pages for streamers only', function () {
    Http::fake(['engine.test/*' => Http::response(engineRooms())]);

    $this->get('/guessword/room')->assertRedirect(route('login'));
    $this->actingAs(User::factory()->create())->get('/guessword/room')->assertForbidden();
    $this->actingAs(User::factory()->create())->post('/guessword/room/start')->assertForbidden();

    $admin = User::factory()->create();
    $admin->role()->associate(Role::factory()->create(['slug' => Role::SUPER_ADMIN]))->save();
    $this->actingAs($admin)->get('/guessword/room')->assertOk();
});

it('creates the room, saves the settings into the engine and keeps the Euler key secret', function () {
    Http::fake(['engine.test/*' => Http::response(engineRooms() + ['running' => false])]);
    $streamer = User::factory()->create(['email' => 'streamer@example.com']);

    $this->actingAs($streamer)->get('/guessword/room')->assertOk()->assertInertia(fn ($p) => $p
        ->component('Guessword/Room')
        ->where('room.hasEulerKey', false)
        ->where('room.overlayUrl', fn ($url) => str_contains($url, '/guessword/engine/r/') && str_ends_with($url, '/guess/?tt=1&alpha=1')));

    $this->actingAs($streamer)->post('/guessword/room', ['tiktok' => '@Mao.Montreal', 'lang' => 'en', 'euler_key' => 'euler-123'])
        ->assertRedirect()->assertSessionHas('success');

    $room = GuesswordRoom::firstWhere('user_id', $streamer->id);
    expect($room->tiktok_username)->toBe('mao.montreal')
        ->and($room->lang)->toBe('en')
        ->and($room->euler_key)->toBe('euler-123')
        ->and($room->getRawOriginal('euler_key'))->not->toContain('euler-123');      // encrypted at rest

    Http::assertSent(fn ($r) => $r->method() === 'PUT'
        && $r->url() === 'http://engine.test/internal/rooms/'.$room->engineId()
        && $r->header('X-Internal-Secret')[0] === 's3cret'
        && $r['username'] === 'mao.montreal' && $r['euler_key'] === 'euler-123' && $r['lang'] === 'en');

    $this->actingAs($streamer)->get('/guessword/room')->assertInertia(fn ($p) => $p
        ->where('room.hasEulerKey', true)
        ->missing('room.euler_key'));
});

it('refuses a TikTok username another streamer already uses', function () {
    Http::fake(['engine.test/*' => Http::response(engineRooms())]);
    config(['guessword.streamers' => ['a@example.com', 'b@example.com']]);
    $a = User::factory()->create(['email' => 'a@example.com']);
    $b = User::factory()->create(['email' => 'b@example.com']);
    $this->actingAs($a)->post('/guessword/room', ['tiktok' => 'mao', 'lang' => 'ru']);

    $this->actingAs($b)->post('/guessword/room', ['tiktok' => '@MAO', 'lang' => 'ru'])->assertSessionHasErrors('tiktok');
});

it('starts and stops the room in the engine', function () {
    Http::fake([
        'engine.test/*' => Http::response(['running' => true]),
        'bot.test/platform/games' => Http::response(['id' => 'gw1', 'game_key' => 'key-1']),
    ]);
    $streamer = User::factory()->create(['email' => 'streamer@example.com']);

    $this->actingAs($streamer)->post('/guessword/room/start')->assertSessionHasErrors('tiktok');   // no username yet

    $this->actingAs($streamer)->post('/guessword/room', ['tiktok' => 'mao', 'lang' => 'ru']);
    $this->actingAs($streamer)->post('/guessword/room/start')->assertSessionHas('success');
    $room = GuesswordRoom::firstWhere('user_id', $streamer->id);
    expect($room->last_started_at)->not->toBeNull();
    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/internal/rooms/'.$room->engineId().'/start'));
    expect($room->tg_key)->toBe('key-1');                                             // registered in the bot once
    Http::assertSent(fn ($r) => $r->url() === 'http://bot.test/platform/games'
        && $r->header('X-Platform-Secret')[0] === 'plat' && $r['id'] === $room->engineId());
    Http::assertSent(fn ($r) => $r->method() === 'PUT' && ($r['tg_key'] ?? null) === 'key-1');   // and the engine got it
    $this->actingAs($streamer)->post('/guessword/room/start');
    expect(collect(Http::recorded())->filter(fn ($pair) => str_contains($pair[0]->url(), 'bot.test'))->count())->toBe(1);

    $this->actingAs($streamer)->post('/guessword/room/stop')->assertSessionHas('success');
    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/internal/rooms/'.$room->engineId().'/stop'));
});

it('makes a new Studio link that replaces the old one', function () {
    Http::fake(['engine.test/*' => Http::response(engineRooms())]);
    $streamer = User::factory()->create(['email' => 'streamer@example.com']);
    $this->actingAs($streamer)->get('/guessword/room');
    $old = GuesswordRoom::firstWhere('user_id', $streamer->id)->overlay_token;

    $this->actingAs($streamer)->post('/guessword/room/link')->assertSessionHas('success');

    $new = GuesswordRoom::firstWhere('user_id', $streamer->id)->overlay_token;
    expect($new)->not->toBe($old);
    Http::assertSent(fn ($r) => $r->method() === 'PUT' && $r['overlay_token'] === $new);
});

it('tells the streamer when the engine does not answer', function () {
    Http::fake(['engine.test/*' => Http::response('', 500)]);
    $streamer = User::factory()->create(['email' => 'streamer@example.com']);

    $this->actingAs($streamer)->post('/guessword/room', ['tiktok' => 'mao', 'lang' => 'ru'])->assertSessionHas('error');
});

it('tells the streamer the room stopped itself without a LIVE', function () {
    $streamer = User::factory()->create(['email' => 'streamer@example.com']);
    $this->actingAs($streamer)->get('/guessword/room');
    $room = GuesswordRoom::firstWhere('user_id', $streamer->id);
    Http::fake(['engine.test/*' => Http::response(engineRooms([
        ['id' => $room->engineId(), 'running' => false, 'stop_reason' => 'no_live'],
    ]))]);

    $this->actingAs($streamer)->get('/guessword/room')->assertInertia(fn ($p) => $p
        ->where('room.running', false)->where('room.stopReason', 'no_live'));
});
