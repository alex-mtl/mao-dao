<?php

declare(strict_types=1);

namespace App\Games\Guessword\Services;

use App\Games\Guessword\Models\GuesswordRoom;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

/**
 * Laravel -> stream-engine (server-to-server, header X-Internal-Secret). Same pattern as the
 * media-sfu sidecar: the engine never touches this database, it gets what it needs per call.
 */
class EngineClient
{
    private function http(): PendingRequest
    {
        $secret = (string) config('guessword.engine_secret');
        if ($secret === '') {
            throw new RuntimeException('GUESSWORD_ENGINE_SECRET is not configured.');
        }

        return Http::baseUrl(rtrim((string) config('guessword.engine_url'), '/'))
            ->withHeaders(['X-Internal-Secret' => $secret])
            ->connectTimeout(2)
            ->timeout(10)
            ->acceptJson();
    }

    /** create or update the room in the engine; returns its status */
    public function sync(GuesswordRoom $room): array
    {
        return $this->http()->put('/internal/rooms/'.$room->engineId(), $room->engineFields())->throw()->json();
    }

    public function start(GuesswordRoom $room): array
    {
        $this->sync($room);

        return $this->http()->post('/internal/rooms/'.$room->engineId().'/start')->throw()->json();
    }

    public function stop(GuesswordRoom $room): array
    {
        return $this->http()->post('/internal/rooms/'.$room->engineId().'/stop')->throw()->json();
    }

    /**
     * status of every engine room keyed by engine id, or null when the engine can't be reached
     * (pages still render; they just don't know what's running)
     */
    public function statuses(): ?array
    {
        try {
            $rooms = $this->http()->get('/internal/rooms')->throw()->json('rooms', []);
        } catch (Throwable) {
            return null;
        }

        return collect($rooms)->keyBy('id')->all();
    }
}
