<?php

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Models\GuesswordSpeech;
use App\Models\User;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->withoutVite();
    config(['guessword.engine_url' => 'http://engine.test', 'guessword.engine_secret' => 's3cret']);
    $u = ['uid' => '1', 'id' => 'ann', 'name' => 'Ann 🇲🇩'];
    $lines = [
        ['t' => '2026-11-11T06:51:04.000-05:00', 's' => 0.0, 'type' => 'live_start', 'epoch' => 1762861864, 'tiktok_room' => '7', 'username' => 'mao'],
        ['s' => 6.0, 'type' => 'round_start', 'round' => 41, 'word' => 'песок'],
        ['s' => 960.0, 'type' => 'winner', 'round' => 41, 'user' => $u, 'word' => 'песок', 'seconds' => 954, 'guesses' => 57, 'streak' => 1],
        ['s' => 960.5, 'type' => 'round_end', 'round' => 41, 'word' => 'песок', 'reason' => 'exact', 'winner' => $u, 'seconds' => 954, 'players' => 9, 'guesses' => 57],
        ['s' => 970.0, 'type' => 'round_start', 'round' => 42, 'word' => 'море'],
    ];
    $log = implode("\n", array_map(fn ($l) => json_encode($l, JSON_UNESCAPED_UNICODE), $lines))."\n";
    Http::fake([
        'engine.test/internal/lives?*' => Http::response(['lives' => [['room' => 'gw1', 'file' => '2026-11-11_065104_7.jsonl', 'size' => 500, 'mtime' => 1]]]),
        'engine.test/internal/lives/*' => Http::response($log),
    ]);
    $this->user = withPack(User::factory()->create(['email' => 'streamer@example.com']));
    $this->actingAs($this->user)->get('/guessword/archive');           // fills the rounds table
    $this->room = GuesswordRoom::first();
    $this->live = '2026-11-11_065104_7.jsonl';
});

function speechFile(array $rows): string
{
    $f = tempnam(sys_get_temp_dir(), 'speech');
    file_put_contents($f, json_encode($rows, JSON_UNESCAPED_UNICODE));

    return $f;
}

it('imports the host speech of a LIVE and replaces it on a second import', function () {
    $f = speechFile([['live_key' => $this->live, 'recording' => 'rec1', 'shift' => 4.4, 'words' => [[5.0, 5.4, 'ну'], [1.0, 1.2, 'привет'], [2, 2.5, ' '], [9, 9.5, 'да']]]]);
    $this->artisan('guessword:speech-import', ['file' => $f, '--room' => $this->room->id])->expectsOutput('stored 1')->assertSuccessful();

    $row = GuesswordSpeech::first();
    expect($row->word_count)->toBe(3)->and($row->words[0][2])->toBe('привет')->and($row->recording)->toBe('rec1')->and((float) $row->shift_s)->toBe(4.4);   // sorted, the blank word dropped

    $f = speechFile([['live_key' => $this->live, 'words' => [[1, 2, 'раз']]]]);
    $this->artisan('guessword:speech-import', ['file' => $f, '--room' => $this->room->id])->assertSuccessful();
    expect(GuesswordSpeech::count())->toBe(1)->and(GuesswordSpeech::first()->word_count)->toBe(1);
});

it('rejects rows without words', function () {
    $f = speechFile([['live_key' => $this->live]]);
    $this->artisan('guessword:speech-import', ['file' => $f, '--room' => $this->room->id])->assertFailed();
});

it('lists LIVEs with speech on the archive page and serves a round\'s words', function () {
    $words = [[3.0, 3.4, 'до'], [100.0, 100.5, 'внутри'], [980.0, 980.5, 'после'], [2000.0, 2000.5, 'далеко']];
    $this->artisan('guessword:speech-import', ['file' => speechFile([['live_key' => $this->live, 'shift' => 4.4, 'words' => $words]]), '--room' => $this->room->id]);

    $this->actingAs($this->user)->get('/guessword/archive')->assertInertia(fn ($p) => $p->where('speech', [$this->live]));

    $r = $this->actingAs($this->user)->getJson("/guessword/archive/rounds/{$this->live}/41/speech")->assertOk()->json();
    expect($r['round'])->toMatchArray(['round' => 41, 'word' => 'песок', 'duration' => 954, 'winner' => 'Ann 🇲🇩', 'winnerId' => 'ann', 'winnerUid' => '1'])
        ->and($r['shift'])->toBe(4.4)
        ->and(array_column($r['words'], 2))->toBe(['до', 'внутри', 'после']);   // from 10 s before the round to 150 s after its end
});

it('answers 404 for a LIVE without speech, an unfinished round or a foreign room', function () {
    $this->actingAs($this->user)->getJson("/guessword/archive/rounds/{$this->live}/41/speech")->assertNotFound();
    $this->artisan('guessword:speech-import', ['file' => speechFile([['live_key' => $this->live, 'words' => [[1, 2, 'раз']]]]), '--room' => $this->room->id]);
    $this->actingAs($this->user)->getJson("/guessword/archive/rounds/{$this->live}/42/speech")->assertNotFound();     // round 42 has no length yet
    $this->actingAs(User::factory()->create())->getJson("/guessword/archive/rounds/{$this->live}/41/speech")->assertForbidden();
});
