<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Guess the Word: what the host said during a LIVE (Whisper's transcript of the recording, made by the clips
 * pipeline on Kaggle), word by word, in the LIVE log's seconds, with the game's announcer already removed.
 * One row per LIVE; the clip form of the archive offers phrases from it (App\Games\Guessword\Services\SpeechArchive).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guessword_speech', function (Blueprint $table) {
            $table->id();
            $table->foreignId('room_id')->constrained('guessword_rooms')->cascadeOnDelete();
            $table->string('live_key', 120);                 // as guessword_rounds.live_key
            $table->string('recording', 40)->nullable();     // the pipeline's recording id
            $table->unsignedInteger('word_count')->default(0);
            $table->json('words');                           // [[start s, end s, "word"], ...] ascending
            $table->timestamps();
            $table->unique(['room_id', 'live_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('guessword_speech');
    }
};
