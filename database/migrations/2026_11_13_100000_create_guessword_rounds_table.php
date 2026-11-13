<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Guess the Word: every round of every LIVE of a streamer's room (App\Games\Guessword\Services\RoundsArchive).
 * Game facts come from the engine's LIVE logs (and journal-rebuilt ones) and are refreshed from them; LIVEs
 * older than the logs and what the clips pipeline learns (where the round is in the recording, a clip,
 * interesting moments) come through `php artisan guessword:rounds-import` and are never overwritten by a refresh.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guessword_rounds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('room_id')->constrained('guessword_rooms')->cascadeOnDelete();
            $table->string('live_key', 120);                   // the LIVE log file (…_<tiktok id>.jsonl) or "rec:<recording id>"
            $table->string('source', 10);                      // live | journal | local (old local game log) | video (game voice in the recording)
            $table->date('live_date');
            $table->timestamp('live_started_at')->nullable();
            $table->unsignedInteger('round');                  // the engine's round number (grows across LIVEs)
            $table->string('word', 100)->nullable();
            $table->string('lang', 5)->nullable();
            $table->string('tier', 20)->nullable();
            $table->string('round_type', 20)->nullable();
            $table->timestamp('started_at')->nullable();
            $table->decimal('offset_s', 9, 1)->nullable();     // seconds from the LIVE's start
            $table->unsignedInteger('duration_s')->nullable();
            $table->string('reason', 10)->nullable();          // exact | timeout | skip
            $table->string('winner_uid', 32)->nullable();
            $table->string('winner_id', 64)->nullable();       // @unique_id without @
            $table->string('winner_name', 120)->nullable();
            $table->unsignedInteger('guesses')->nullable();
            $table->unsignedInteger('players')->nullable();
            $table->unsignedInteger('streak')->nullable();
            $table->string('setter_name', 120)->nullable();    // the viewer who picked the word
            $table->string('recording', 40)->nullable();       // the clips pipeline's recording id (2026-11-11_0651_3h35m)
            $table->decimal('recording_s', 9, 1)->nullable();  // where the round starts in that recording
            $table->string('clip_url', 500)->nullable();
            $table->string('clip_title', 200)->nullable();
            $table->json('moments')->nullable();               // [{at, kind, text}] from the recording's transcript
            $table->timestamps();
            $table->unique(['room_id', 'live_key', 'round']);
            $table->index(['room_id', 'live_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('guessword_rounds');
    }
};
