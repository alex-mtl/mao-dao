<?php

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Models\GuesswordRound;
use App\Models\User;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->withoutVite();
    config(['guessword.engine_url' => 'http://engine.test', 'guessword.engine_secret' => 's3cret']);
    $u = fn ($uid, $name) => ['uid' => $uid, 'id' => 'id'.$uid, 'name' => $name];
    $lines = [
        ['t' => '2026-11-11T06:51:04.000-05:00', 's' => 0.0, 'type' => 'live_start', 'epoch' => 1762861864, 'tiktok_room' => '7', 'username' => 'mao'],
        ['s' => 6.0, 'type' => 'round_start', 'round' => 41, 'word' => 'песок', 'lang' => 'ru', 'tier' => 'easy', 'round_type' => 'normal', 'duration' => 600],
        ['s' => 250.0, 'type' => 'winner', 'round' => 41, 'user' => $u('1', 'Ann'), 'word' => 'песок', 'seconds' => 244, 'guesses' => 57, 'streak' => 2],
        ['s' => 250.5, 'type' => 'round_end', 'round' => 41, 'word' => 'песок', 'reason' => 'exact', 'winner' => $u('1', 'Ann'), 'seconds' => 244, 'players' => 9, 'guesses' => 57],
        ['s' => 260.0, 'type' => 'round_start', 'round' => 42, 'word' => 'море'],
        ['s' => 960.0, 'type' => 'round_end', 'round' => 42, 'word' => 'море', 'reason' => 'timeout', 'seconds' => 700, 'players' => 4, 'guesses' => 80],
        ['s' => 970.0, 'type' => 'round_start', 'round' => 43, 'word' => 'лес'],
    ];
    $log = implode("\n", array_map(fn ($l) => json_encode($l, JSON_UNESCAPED_UNICODE), $lines))."\n";
    Http::fake([
        'engine.test/internal/lives?*' => Http::response(['lives' => [['room' => 'gw1', 'file' => '2026-11-11_065104_7.jsonl', 'size' => 500, 'mtime' => 1]]]),
        'engine.test/internal/lives/*' => Http::response($log),
    ]);
    $this->user = withPack(User::factory()->create(['email' => 'streamer@example.com']));
});

it('fills the rounds table from the LIVE logs when the archive opens', function () {
    $this->actingAs($this->user)->get('/guessword/archive')->assertOk()->assertInertia(fn ($p) => $p
        ->where('strips', fn ($s) => collect($s)->toArray() === ['2026-11-11_065104_7.jsonl' => [[244, 'exact', 0], [700, 'timeout', 0], [0, '', 0]]]));

    $r = GuesswordRound::where('round', 41)->first();
    expect($r->word)->toBe('песок')
        ->and($r->winner_name)->toBe('Ann')->and($r->winner_id)->toBe('id1')
        ->and($r->guesses)->toBe(57)->and($r->players)->toBe(9)->and($r->streak)->toBe(2)
        ->and($r->duration_s)->toBe(244)->and($r->live_date->format('Y-m-d'))->toBe('2026-11-11')
        ->and($r->source)->toBe('live');
    expect(GuesswordRound::where('round', 43)->value('duration_s'))->toBeNull();   // still going when the log ends

    $rows = $this->actingAs($this->user)->getJson('/guessword/archive/rounds/2026-11-11_065104_7.jsonl')->assertOk()->json();
    expect(array_column($rows, 'word'))->toBe(['песок', 'море', 'лес'])
        ->and($rows[1])->toMatchArray(['reason' => 'timeout', 'duration' => 700, 'winner' => null]);
});

it('imports old LIVEs and clips without a refresh from the logs undoing them', function () {
    $this->actingAs($this->user)->get('/guessword/archive');
    $room = GuesswordRoom::first();
    $file = tempnam(sys_get_temp_dir(), 'rounds');
    file_put_contents($file, json_encode([
        ['live_key' => '2026-11-11_065104_7.jsonl', 'round' => 42, 'clip_url' => 'https://www.tiktok.com/@mao/video/1',
            'recording' => '2026-11-11_0651_3h35m', 'recording_s' => 300, 'moments' => [['at' => 900, 'kind' => 'hard', 'text' => 'Ну, родили']]],
        ['live_key' => 'rec:2026-10-15_0854_2h08m', 'round' => 5, 'live_date' => '2026-10-15', 'word' => 'миллион', 'offset_s' => 120,
            'duration_s' => 640, 'reason' => 'exact', 'winner_name' => 'Нина'],
        ['live_key' => 'rec:x', 'round' => 1],
    ]));

    $this->artisan('guessword:rounds-import', ['file' => $file, '--room' => $room->id])
        ->expectsOutput('created 1, updated 1')->assertFailed();          // the third row has no live_date

    // the log is read again (it grew): game columns refresh, the clip stays
    Http::fake(['engine.test/internal/lives?*' => Http::response(['lives' => [['room' => 'gw1', 'file' => '2026-11-11_065104_7.jsonl', 'size' => 600, 'mtime' => 1]]])]);
    $this->actingAs($this->user)->get('/guessword/archive')->assertInertia(fn ($p) => $p
        ->has('recorded', 1)
        ->where('recorded.0.file', 'rec:2026-10-15_0854_2h08m')
        ->where('recorded.0.rounds', 1)
        ->where('recorded.0.champion.name', 'Нина')
        ->where('strips', fn ($s) => collect($s)->toArray()['2026-11-11_065104_7.jsonl'][1] === [700, 'timeout', 1]));
    expect(GuesswordRound::where('round', 42)->value('clip_url'))->toBe('https://www.tiktok.com/@mao/video/1');

    $old = $this->actingAs($this->user)->getJson('/guessword/archive/rounds/rec:2026-10-15_0854_2h08m')->assertOk()->json();
    expect($old[0])->toMatchArray(['word' => 'миллион', 'duration' => 640, 'winner' => 'Нина']);
    unlink($file);
});
