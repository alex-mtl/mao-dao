<?php

declare(strict_types=1);

namespace App\Games\Guessword\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A streamer's Guess the Word room. The game runs in the stream-engine sidecar under the id
 * engineId(); its pages are published by nginx under config('guessword.public_path').
 */
class GuesswordRoom extends Model
{
    protected $table = 'guessword_rooms';

    // the controller assigns fields one by one after validation; user_id is set by firstOrCreate
    protected $fillable = ['user_id', 'lang'];

    protected $hidden = ['euler_key', 'tg_key', 'overlay_token', 'control_token'];

    protected function casts(): array
    {
        return [
            'euler_key' => 'encrypted',
            'tg_key' => 'encrypted',
            'last_started_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (GuesswordRoom $room) {
            $room->overlay_token ??= Str::random(40);
            $room->control_token ??= Str::random(40);
        });
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** the room's id inside the engine */
    public function engineId(): string
    {
        return 'gw'.$this->id;
    }

    // url() would drop the slash before "?" (".../guess?tt=1"), so only the base goes through it
    public function overlayUrl(): string
    {
        return $this->engineBase($this->overlay_token).'guess/?tt=1&alpha=1';
    }

    public function controlUrl(): string
    {
        return $this->engineBase($this->control_token);
    }

    private function engineBase(string $token): string
    {
        return rtrim(url(config('guessword.public_path')), '/').'/r/'.$token.'/';
    }

    public function regenerateOverlayToken(): void
    {
        $this->overlay_token = Str::random(40);
        $this->save();
    }

    /** what the engine gets for this room (PUT /internal/rooms/{id}) */
    public function engineFields(): array
    {
        return [
            'username' => $this->tiktok_username ?? '',
            'lang' => $this->lang,
            'euler_key' => $this->euler_key ?? '',
            'tg_key' => $this->tg_key ?? '',
            'overlay_token' => $this->overlay_token,
            'control_token' => $this->control_token,
        ];
    }
}
