<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The few Kaggle REST calls the speech job needs (what tiktok-clips/kaggle/*.ps1 do from the owner's PC): a private dataset with
 * the sound, a GPU script kernel attached to it, the kernel's output. Gotchas are in tiktok-clips/docs/pipeline.md
 * ("Kaggle: лимиты и зависания"): 2 GPU sessions at a time, a fresh dataset is not ready for a minute, status is only visible
 * from the kernel's output files.
 */
class KaggleClient
{
    private const API = 'https://api.kaggle.com/v1/';

    private function http(): PendingRequest
    {
        $token = (string) config('guessword.speech.kaggle_token');
        if ($token === '') {
            throw new RuntimeException('KAGGLE_TOKEN is not set');
        }

        return Http::withToken($token)->acceptJson()->timeout(120);
    }

    private function call(string $service, string $method, array $body): array
    {
        $r = $this->http()->asJson()->post(self::API."$service/$method", $body);
        if (! $r->successful()) {
            throw new RuntimeException("Kaggle $method: HTTP {$r->status()} ".mb_substr($r->body(), 0, 200));
        }
        $j = $r->json() ?? [];
        if (! empty($j['error'])) {
            throw new RuntimeException("Kaggle $method: ".json_encode($j['error']));
        }

        return $j;
    }

    private function user(): string
    {
        return (string) config('guessword.speech.kaggle_user');
    }

    /** a private dataset of the given files ({name => path}); returns "owner/slug" */
    public function createDataset(string $slug, string $title, array $files): string
    {
        $tokens = [];
        foreach ($files as $name => $path) {
            $r = $this->call('blobs.BlobApiService', 'StartBlobUpload', [
                'type' => 'DATASET', 'name' => $name, 'contentType' => 'application/octet-stream',
                'contentLength' => filesize($path), 'lastModifiedEpochSeconds' => filemtime($path),
            ]);
            $put = Http::timeout(600)->withBody(file_get_contents($path), 'application/octet-stream')->put($r['createUrl']);
            if (! $put->successful()) {
                throw new RuntimeException("Kaggle upload $name: HTTP {$put->status()}");
            }
            $tokens[] = ['token' => $r['token']];
        }
        $this->call('datasets.DatasetApiService', 'CreateDataset', [
            'ownerSlug' => $this->user(), 'slug' => $slug, 'title' => $title, 'licenseName' => 'unknown', 'isPrivate' => true, 'files' => $tokens,
        ]);

        return $this->user().'/'.$slug;
    }

    /** pushes the kernel (script text) attached to the dataset and starts a run; false while the dataset is still processing */
    public function runKernel(string $dataset, string $script): bool
    {
        $slug = (string) config('guessword.speech.kernel');
        $r = $this->http()->asJson()->post(self::API.'kernels.KernelsApiService/SaveKernel', [
            'slug' => $this->user().'/'.$slug, 'newTitle' => $slug, 'text' => str_replace("\r\n", "\n", $script),
            'language' => 'python', 'kernelType' => 'script', 'isPrivate' => true, 'enableGpu' => true, 'enableInternet' => true,
            'datasetDataSources' => [$dataset],
        ]);
        $j = $r->json() ?? [];
        // any "invalid...dataset/source..." list in the answer means the run starts WITHOUT the sound (seen 2026-11-21: a run ended
        // in 49 s with "No Attached Data Sources", output empty) - so every such key counts, not only the one spelling
        foreach ($j as $key => $value) {
            if (! empty($value) && preg_match('/invalid.*(dataset|source)/i', (string) $key)) {
                return false;
            }
        }
        if (! $r->successful() || ! empty($j['error'])) {
            throw new RuntimeException('Kaggle SaveKernel: HTTP '.$r->status().' '.mb_substr($r->body(), 0, 200));
        }

        return true;
    }

    /** {files: [{fileName, url}], log: string} of the kernel's latest run */
    public function output(): array
    {
        $j = $this->call('kernels.KernelsApiService', 'ListKernelSessionOutput', [
            'userName' => $this->user(), 'kernelSlug' => (string) config('guessword.speech.kernel'), 'pageSize' => 50,
        ]);

        return ['files' => $j['files'] ?? [], 'log' => (string) ($j['log'] ?? '')];
    }

    /** the text of an output file by its signed url */
    public function download(string $url): string
    {
        $r = Http::timeout(300)->get($url);
        if (! $r->successful()) {
            throw new RuntimeException('Kaggle download: HTTP '.$r->status());
        }

        return $r->body();
    }
}
