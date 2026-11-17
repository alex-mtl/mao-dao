<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use App\Games\Guessword\Models\GuesswordRoom;
use App\Games\Guessword\Models\GuesswordRound;
use App\Games\Guessword\Models\GuesswordSpeechJob;
use RuntimeException;
use Throwable;

/**
 * "Get the markup" of a LIVE: the extension hands over the address of the LIVE Center recording, the worker
 * (guessword:speech-worker) pulls the sound out of it (SpeechAudio), has Kaggle transcribe it (KaggleClient, the script is
 * services/speech-kernel/transcribe_novad.py), cuts the game's announcer out (SpeechAlign) and loads the host's words into
 * guessword_speech (SpeechArchive) - what the clip form of the archive needs. A job moves queued -> audio -> kaggle -> import -> done.
 */
class SpeechJobs
{
    /** the address must be one of TikTok's CDN, like the extension's own check */
    private const CDN = '#^https://[a-z0-9.-]+\.(tiktokcdn|tiktokcdn-us|tiktokcdn-eu)\.com/#';

    public function __construct(
        private LiveArchive $archive,
        private SpeechArchive $speech,
        private SpeechAudio $audio,
        private SpeechAlign $align,
        private KaggleClient $kaggle,
    ) {}

    public static function validAddress(string $m3u8): bool
    {
        return preg_match(self::CDN, $m3u8) === 1 && str_contains($m3u8, '.m3u8');
    }

    /** a job for the LIVE, or the one already running for it */
    public function start(GuesswordRoom $room, string $live, string $m3u8, int $recordingStart, int $duration, ?string $recording): GuesswordSpeechJob
    {
        $running = GuesswordSpeechJob::where('room_id', $room->id)->where('live_key', $live)->whereIn('status', GuesswordSpeechJob::ACTIVE)->first();
        if ($running) {
            return $running;
        }

        return GuesswordSpeechJob::create([
            'room_id' => $room->id, 'live_key' => $live, 'status' => 'queued', 'm3u8' => $m3u8,
            'recording' => $recording, 'recording_start' => $recordingStart, 'duration_s' => $duration,
        ]);
    }

    /** the latest job of every LIVE of the room: {live_key: {id, status, note, error}} */
    public function statuses(GuesswordRoom $room): array
    {
        $out = [];
        foreach (GuesswordSpeechJob::where('room_id', $room->id)->orderBy('id')->get() as $j) {
            $out[$j->live_key] = ['id' => $j->id, 'status' => $j->status, 'note' => $j->note, 'error' => $j->error];
        }

        return $out;
    }

    public function dir(GuesswordSpeechJob $job): string
    {
        return config('guessword.speech.dir').'/'.$job->sid();
    }

    /** advances a job by one stage; a stage can take long (sound: minutes, Kaggle: one check per call) */
    public function step(GuesswordSpeechJob $job): void
    {
        try {
            match ($job->status) {
                'queued', 'audio' => $this->audioAndPush($job),
                'kaggle' => $this->checkKaggle($job),
                'import' => $this->import($job),
                default => null,
            };
        } catch (Throwable $e) {
            report($e);
            $job->update(['status' => 'failed', 'note' => null, 'error' => mb_substr(preg_replace('#https?://\S+#', '<url>', $e->getMessage()), 0, 1000)]);
        }
    }

    private function audioAndPush(GuesswordSpeechJob $job): void
    {
        $room = GuesswordRoom::findOrFail($job->room_id);
        if (! $this->hasLive($room, $job->live_key)) {
            throw new RuntimeException('the LIVE log is not available (engine offline?)');
        }
        $job->update(['status' => 'audio', 'note' => 'audio 0']);
        $dir = $this->dir($job);
        $parts = $this->audio->extract($job->m3u8, $job->duration_s, $dir, fn (int $done, int $n) => $job->update(['note' => "audio $done/$n"]));

        $sid = $job->sid();
        $csv = '';
        $files = [];
        foreach ($parts as $i => $p) {
            $end = $parts[$i + 1]['offset'] ?? $job->duration_s;
            $csv .= "{$p['file']},{$p['offset']},{$end}\n";
            $files["{$sid}__{$p['file']}"] = "$dir/{$p['file']}";
        }
        file_put_contents("$dir/segments.csv", $csv);
        $files["{$sid}__segments.csv"] = "$dir/segments.csv";

        $job->update(['note' => 'upload']);
        $slug = 'maodao-speech-'.$job->id;
        $dataset = $this->kaggle->createDataset($slug, 'maodao speech '.$job->id, $files);
        $script = (string) file_get_contents(base_path('services/speech-kernel/transcribe_novad.py'));
        // a fresh dataset is still processed for a minute: the push is answered "invalidDatasetSources" until then
        for ($try = 0; ! $this->kaggle->runKernel($dataset, $script); $try++) {
            if ($try >= 20) {
                throw new RuntimeException('Kaggle did not accept the dataset in 10 minutes');
            }
            sleep(30);
        }
        $job->update(['status' => 'kaggle', 'note' => 'whisper', 'dataset' => $dataset, 'kaggle_pushed_at' => now()]);
    }

    private function checkKaggle(GuesswordSpeechJob $job): void
    {
        $sid = $job->sid();
        $out = $this->kaggle->output();
        foreach ($out['files'] as $f) {
            if (($f['fileName'] ?? '') === "$sid/transcript.json") {
                $dir = $this->dir($job);
                file_put_contents("$dir/transcript.json", $this->kaggle->download($f['url']));
                $job->update(['status' => 'import', 'note' => 'import']);

                return;
            }
        }
        $age = (int) $job->kaggle_pushed_at->diffInMinutes(now());
        // the log of the run before ours may still be shown for a while: its error counts only once our run has started
        if (str_contains($out['log'], 'Traceback') && (str_contains($out['log'], $sid) || $age > 10)) {
            throw new RuntimeException('Kaggle: '.mb_substr(trim(mb_substr($out['log'], -600)), 0, 500));
        }
        if ($age > (int) config('guessword.speech.kaggle_max_min')) {
            throw new RuntimeException('Kaggle did not finish in '.config('guessword.speech.kaggle_max_min').' minutes');
        }
        $job->update(['note' => "whisper {$age} min"]);
    }

    private function import(GuesswordSpeechJob $job): void
    {
        $room = GuesswordRoom::findOrFail($job->room_id);
        [$events, $epoch] = $this->timeline($room, $job->live_key, (float) $job->recording_start);
        if (! $epoch) {
            throw new RuntimeException('the LIVE log has no start time');
        }
        $tr = json_decode((string) file_get_contents($this->dir($job).'/transcript.json'), true);
        if (! is_array($tr)) {
            throw new RuntimeException('the transcript is not JSON');
        }
        $words = [];
        foreach ($tr['segments'] ?? [] as $s) {
            foreach ($s['words'] ?? [] as $w) {
                $words[] = $w;
            }
        }
        $r = $this->align->align($words, $events, $epoch, (float) $job->recording_start);
        [$stored, $errors] = $this->speech->import($room, [['live_key' => $job->live_key, 'recording' => $job->recording, 'shift' => $r['shift'], 'words' => $r['words']]]);
        if ($errors) {
            throw new RuntimeException(implode('; ', $errors));
        }
        $this->cleanup($job);
        $job->update(['status' => 'done', 'note' => count($r['words']).' words, shift '.$r['shift'].' s (refined by '.$r['refined'].' rounds)']);
    }

    /** is there a LIVE to mark up: a logged one, or one known only from its recording (`rec:<id>`, rounds table) */
    public function hasLive(GuesswordRoom $room, string $live): bool
    {
        return str_starts_with($live, 'rec:')
            ? GuesswordRound::where('room_id', $room->id)->where('live_key', $live)->exists()
            : $this->archive->events($room, $live) !== null;
    }

    /**
     * The LIVE's events (round_start / winner with 's') and the unix time of its second 0. A `rec:` LIVE has no log: its events are
     * rebuilt from the rounds table; the clock comes from `recording_s` (where the round is in the recording) when known, else from
     * the LIVE's start time.
     *
     * @return array{0: array, 1: float|null}
     */
    public function timeline(GuesswordRoom $room, string $live, float $recStart): array
    {
        if (! str_starts_with($live, 'rec:')) {
            $events = $this->archive->events($room, $live) ?? [];
            $start = collect($events)->firstWhere('type', 'live_start');

            return [$events, ! empty($start['epoch']) ? (float) $start['epoch'] : null];
        }
        $rounds = GuesswordRound::where('room_id', $room->id)->where('live_key', $live)->whereNotNull('offset_s')->orderBy('round')->get();
        $events = [];
        foreach ($rounds as $r) {
            $events[] = ['type' => 'round_start', 's' => (float) $r->offset_s, 'round' => $r->round];
            if ($r->duration_s !== null) {
                $events[] = ['type' => $r->winner_name ? 'winner' : 'round_end', 's' => (float) $r->offset_s + $r->duration_s, 'round' => $r->round];
            }
        }
        $diffs = $rounds->filter(fn ($r) => $r->recording_s !== null)->map(fn ($r) => (float) $r->recording_s - (float) $r->offset_s)->sort()->values();
        $epoch = $diffs->isNotEmpty()
            ? $recStart + $diffs[intdiv($diffs->count(), 2)]
            : $rounds->first()?->live_started_at?->getTimestamp();

        return [$events, $epoch ? (float) $epoch : null];
    }

    private function cleanup(GuesswordSpeechJob $job): void
    {
        $dir = $this->dir($job);
        foreach (glob("$dir/*") ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($dir);
    }
}
