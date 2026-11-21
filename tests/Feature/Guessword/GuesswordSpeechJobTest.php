<?php

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Models\GuesswordSpeech;
use App\Games\Guessword\Models\GuesswordSpeechJob;
use App\Games\Guessword\Services\SpeechAlign;
use App\Games\Guessword\Services\SpeechJobs;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\Http;

const MAO_CDN = 'https://v16m-ttgl.tiktokcdn.com/aa/bb/dash/x.m3u8?sig=1';

beforeEach(function () {
    $this->withoutVite();
    config(['guessword.engine_url' => 'http://engine.test', 'guessword.engine_secret' => 's3cret']);
    $lines = [
        ['t' => '2026-11-11T06:51:04.000-05:00', 's' => 0.0, 'type' => 'live_start', 'epoch' => 1000, 'tiktok_room' => '7', 'username' => 'mao'],
        ['s' => 100.0, 'type' => 'round_start', 'round' => 41, 'word' => 'песок'],
        ['s' => 200.0, 'type' => 'round_start', 'round' => 42, 'word' => 'море'],
        ['s' => 300.0, 'type' => 'round_start', 'round' => 43, 'word' => 'лес'],
        ['s' => 400.0, 'type' => 'round_start', 'round' => 44, 'word' => 'дом'],
        ['s' => 500.0, 'type' => 'round_start', 'round' => 45, 'word' => 'сад'],
        ['s' => 600.0, 'type' => 'winner', 'round' => 45, 'user' => ['uid' => '1', 'id' => 'ann', 'name' => 'Ann'], 'word' => 'сад', 'seconds' => 100, 'guesses' => 5, 'streak' => 1],
    ];
    $this->log = implode("\n", array_map(fn ($l) => json_encode($l, JSON_UNESCAPED_UNICODE), $lines))."\n";
    Http::fake([
        'engine.test/internal/lives?*' => Http::response(['lives' => [['room' => 'gw1', 'file' => '2026-11-11_065104_7.jsonl', 'size' => 500, 'mtime' => 1]]]),
        'engine.test/internal/lives/*' => Http::response($this->log),
    ]);
    $this->admin = User::factory()->create();
    $this->admin->role()->associate(Role::factory()->create(['slug' => Role::SUPER_ADMIN]))->save();
    $this->actingAs($this->admin)->get('/guessword/archive');
    $this->room = GuesswordRoom::first();
    $this->live = '2026-11-11_065104_7.jsonl';
});

it('aligns the host words with the log and cuts the announcer out', function () {
    // the recording started 20 s before the log (recording second = log second + 20 by the clocks, but the announcer says 23 s)
    $words = [];
    foreach ([41 => 100, 42 => 200, 43 => 300, 44 => 400, 45 => 500] as $round => $s) {
        $t = $s + 23;
        $words[] = ['w' => 'Раунд', 's' => $t, 'e' => $t + 0.3];
        $words[] = ['w' => (string) $round, 's' => $t + 0.3, 'e' => $t + 0.6];
        $words[] = ['w' => 'Поехали.', 's' => $t + 0.6, 'e' => $t + 1.0];
    }
    $words[] = ['w' => 'Ну', 's' => 150 + 23, 'e' => 150.4 + 23];
    $words[] = ['w' => 'давайте', 's' => 150.5 + 23, 'e' => 151 + 23];

    $r = app(SpeechAlign::class)->align($words, app(\App\Games\Guessword\Services\LiveArchive::class)->events($this->room, $this->live), 1020.0, 1000.0);

    expect($r['refined'])->toBe(5)->and($r['shift'])->toBe(23.0)       // the announcer's own word beats the clocks' 20 s
        ->and($r['words'])->toBe([[150.0, 150.4, 'Ну'], [150.5, 151.0, 'давайте']])
        ->and($r['dropped'])->toBe(15);
});

it('keeps the clocks\' shift when the announcer is not heard often enough', function () {
    $r = app(SpeechAlign::class)->align([['w' => 'Привет', 's' => 130, 'e' => 130.5]], [['type' => 'round_start', 'round' => 41, 's' => 100.0]], 1020.0, 1000.0);

    expect($r['shift'])->toBe(20.0)->and($r['refined'])->toBe(0)->and($r['words'])->toBe([[110.0, 110.5, 'Привет']]);
});

it('starts a markup job only for super admins and only from a TikTok address', function () {
    $body = ['m3u8' => MAO_CDN, 'start' => 1000, 'duration' => 7200, 'recording' => '77'];
    $streamer = withPack(User::factory()->create());
    $this->actingAs($streamer)->postJson("/guessword/archive/speech-job/{$this->live}", $body)->assertForbidden();

    $this->actingAs($this->admin)->postJson("/guessword/rooms/{$this->room->id}/archive/speech-job/{$this->live}", ['m3u8' => 'https://evil.example/x.m3u8'] + $body)->assertStatus(422);

    $id = $this->actingAs($this->admin)->postJson("/guessword/rooms/{$this->room->id}/archive/speech-job/{$this->live}", $body)
        ->assertOk()->json('id');
    // the second press finds the same running job
    $this->actingAs($this->admin)->postJson("/guessword/rooms/{$this->room->id}/archive/speech-job/{$this->live}", $body)->assertJsonPath('id', $id);
    expect(GuesswordSpeechJob::count())->toBe(1);

    $jobs = $this->actingAs($this->admin)->getJson("/guessword/rooms/{$this->room->id}/archive/speech-jobs")->json();
    expect($jobs[$this->live]['status'])->toBe('queued')
        ->and($jobs[$this->live])->not->toHaveKey('m3u8');   // the signed address never goes back to the browser
});

it('imports the transcript of a finished Kaggle run into the LIVE\'s speech', function () {
    $job = GuesswordSpeechJob::create(['room_id' => $this->room->id, 'live_key' => $this->live, 'status' => 'import', 'm3u8' => MAO_CDN,
        'recording' => '77', 'recording_start' => 1000, 'duration_s' => 7200]);
    $dir = app(SpeechJobs::class)->dir($job);
    mkdir($dir, 0775, true);
    file_put_contents("$dir/transcript.json", json_encode(['segments' => [['words' => [['w' => 'ну', 's' => 150.0, 'e' => 150.4], ['w' => 'да', 's' => 151.0, 'e' => 151.3]]]]]));

    $this->artisan('guessword:speech-worker', ['--once' => true])->assertSuccessful();

    expect($job->fresh()->status)->toBe('done')->and(is_dir($dir))->toBeFalse();
    $row = GuesswordSpeech::first();
    expect($row->live_key)->toBe($this->live)->and($row->word_count)->toBe(2)->and($row->recording)->toBe('77')
        ->and((float) $row->shift_s)->toBe(0.0)->and($row->words[0])->toEqual([150, 150.4, 'ну']);   // epoch 1000 = recording start 1000
});

it('fails a job whose Kaggle run died, without keeping the address in the message', function () {
    config(['guessword.speech.kaggle_token' => 'tok']);
    $job = GuesswordSpeechJob::create(['room_id' => $this->room->id, 'live_key' => $this->live, 'status' => 'kaggle', 'm3u8' => MAO_CDN,
        'recording_start' => 1000, 'duration_s' => 7200, 'kaggle_pushed_at' => now()->subMinutes(30)]);
    Http::fake(['api.kaggle.com/*' => Http::response(['files' => [], 'log' => "install...\nTraceback (most recent call last):\n  boom https://x.tiktokcdn.com/a.m3u8?sig=9"])]);

    $this->artisan('guessword:speech-worker', ['--once' => true])->assertSuccessful();

    $job->refresh();
    expect($job->status)->toBe('failed')->and($job->error)->toContain('Traceback')->and($job->error)->not->toContain('sig=9');
});

it('fails at once a job whose Kaggle run finished without its audio, but not while the log may be the previous run\'s', function () {
    config(['guessword.speech.kaggle_token' => 'tok']);
    Http::fake(['api.kaggle.com/*' => Http::response(['files' => [], 'log' => "install...\nALL_DONE\n"])]);
    $job = GuesswordSpeechJob::create(['room_id' => $this->room->id, 'live_key' => $this->live, 'status' => 'kaggle', 'm3u8' => MAO_CDN,
        'recording_start' => 1000, 'duration_s' => 7200, 'kaggle_pushed_at' => now()->subMinutes(3)]);

    $this->artisan('guessword:speech-worker', ['--once' => true])->assertSuccessful();
    expect($job->fresh()->status)->toBe('kaggle');   // 3 min after the push: the log may still be the previous run's

    $job->update(['kaggle_pushed_at' => now()->subMinutes(12)]);
    $this->artisan('guessword:speech-worker', ['--once' => true])->assertSuccessful();
    expect($job->fresh()->status)->toBe('failed')->and($job->fresh()->error)->toContain('without our audio');
});

it('takes a markup job for a LIVE known only from its recording (rec:) and dates it by recording_s', function () {
    foreach ([1 => 50, 2 => 150, 3 => 250] as $n => $off) {
        \App\Games\Guessword\Models\GuesswordRound::create([
            'room_id' => $this->room->id, 'live_key' => 'rec:77', 'round' => $n, 'live_date' => '2026-10-20', 'source' => 'local',
            'offset_s' => $off, 'duration_s' => 60, 'recording_s' => $off + 30,
        ]);
    }
    $body = ['m3u8' => MAO_CDN, 'start' => 5000, 'duration' => 7200, 'recording' => '77'];
    $this->actingAs($this->admin)->postJson("/guessword/rooms/{$this->room->id}/archive/speech-job/rec:77", $body)->assertOk();
    $this->actingAs($this->admin)->postJson("/guessword/rooms/{$this->room->id}/archive/speech-job/rec:99", $body)->assertNotFound();

    [$events, $epoch] = app(SpeechJobs::class)->timeline($this->room, 'rec:77', 5000.0);
    expect($epoch)->toBe(5030.0)->and(count($events))->toBe(6);   // the recording's second 0 = log second 0 + 30 s of shift
});
