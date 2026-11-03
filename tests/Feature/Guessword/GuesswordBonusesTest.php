<?php

use App\Games\Guessword\Models\GuesswordRoom;
use App\Models\User;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    config([
        'guessword.engine_url' => 'http://engine.test',
        'guessword.engine_secret' => 's3cret',
    ]);
    Http::fake(['engine.test/*' => Http::response(['ok' => true])]);
});

it('lets the streamer put a cake on a viewer\'s account and tells the engine', function () {
    $streamer = withPack(User::factory()->create());

    $this->actingAs($streamer)->postJson('/guessword/room/bonuses', ['viewer' => '@NinEmdaz', 'kind' => 'cake', 'delta' => 2, 'name' => 'Nina'])
        ->assertOk()->assertJson(['viewer' => 'ninemdaz', 'balance' => 2]);
    $this->actingAs($streamer)->postJson('/guessword/room/bonuses', ['viewer' => 'ninemdaz', 'kind' => 'cake', 'delta' => -5])
        ->assertOk()->assertJson(['balance' => 0]);                       // never below 0
    $this->actingAs($streamer)->postJson('/guessword/room/bonuses', ['viewer' => 'ninemdaz', 'kind' => 'gold', 'delta' => 1])
        ->assertUnprocessable();

    $room = GuesswordRoom::where('user_id', $streamer->id)->first();
    Http::assertSent(fn ($r) => $r->url() === 'http://engine.test/internal/rooms/'.$room->engineId().'/bonuses'
        && $r->body() === '{"id":"ninemdaz","balances":{"cake":2}}');

    $this->actingAs($streamer)->getJson('/guessword/room/bonuses?viewer=ninemdaz')->assertOk()
        ->assertJsonPath('players.0.name', 'Nina')
        ->assertJsonPath('log.0.delta', -2)
        ->assertJsonPath('log.0.by', $streamer->name);
});

it('keeps every streamer to their own room', function () {
    $a = withPack(User::factory()->create());
    $other = GuesswordRoom::create(['user_id' => User::factory()->create()->id, 'lang' => 'ru']);

    $this->actingAs($a)->postJson('/guessword/rooms/'.$other->id.'/bonuses', ['viewer' => 'x', 'kind' => 'hint', 'delta' => 1])
        ->assertForbidden();
    $this->actingAs(User::factory()->create())->getJson('/guessword/room/bonuses')->assertForbidden();
});

it('applies the engine\'s operations once and gives it the balances', function () {
    $room = GuesswordRoom::create(['user_id' => User::factory()->create()->id, 'lang' => 'ru']);
    $ops = ['room' => $room->engineId(), 'ops' => [
        ['op' => 'a1', 'viewer' => 'eva', 'kind' => 'hint', 'delta' => 3, 'source' => 'gift', 'name' => 'Eva'],
        ['op' => 'a2', 'viewer' => 'eva', 'kind' => 'hint', 'delta' => -1, 'source' => 'spend'],
    ]];

    $this->postJson('/internal/guessword/bonuses', $ops)->assertForbidden();
    $headers = ['X-Internal-Secret' => 's3cret'];
    $this->postJson('/internal/guessword/bonuses', $ops, $headers)->assertOk()->assertJson(['balances' => ['eva' => ['hint' => 2]]]);
    $this->postJson('/internal/guessword/bonuses', $ops, $headers)->assertOk()->assertJson(['balances' => ['eva' => ['hint' => 2]]]);   // a retry

    $this->getJson('/internal/guessword/bonuses?room='.$room->engineId(), $headers)->assertOk()
        ->assertExactJson(['balances' => ['eva' => ['hint' => 2]]]);
    Http::assertNothingSent();                                             // the engine's own changes go nowhere
});

it('gives bonuses from the console', function () {
    $room = GuesswordRoom::create(['user_id' => User::factory()->create()->id, 'lang' => 'ru']);

    $this->artisan('guessword:bonus', ['viewer' => 'ninemdaz', 'n' => 1, '--kind' => 'cake', '--room' => $room->engineId()])->assertSuccessful();
    $this->artisan('guessword:hints', ['viewer' => '@NinEmdaz', 'n' => 2])->assertSuccessful();

    expect(app(\App\Games\Guessword\Services\Bonuses::class)->of($room, 'ninemdaz'))->toEqual(['cake' => 1, 'hint' => 2]);
});
