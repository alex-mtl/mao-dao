<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Guess the Word: "get the markup" of one LIVE (archive button). The browser extension hands over the address of the LIVE Center
 * recording; the worker (guessword:speech-worker) pulls the sound out of it, has Kaggle transcribe it and loads the host's words
 * into guessword_speech. status: queued | audio | kaggle | import | done | failed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guessword_speech_jobs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('room_id')->constrained('guessword_rooms')->cascadeOnDelete();
            $table->string('live_key', 120);
            $table->string('status', 10)->default('queued');
            $table->string('note', 200)->nullable();         // progress line for the archive ("audio 3/6")
            $table->text('error')->nullable();
            $table->text('m3u8');                            // signed address of the recording's playlist
            $table->string('recording', 40)->nullable();     // LIVE Center recording id
            $table->unsignedBigInteger('recording_start');   // unix s of the recording's second 0
            $table->unsignedInteger('duration_s');
            $table->string('dataset', 80)->nullable();       // Kaggle dataset slug
            $table->timestamp('kaggle_pushed_at')->nullable();
            $table->timestamps();
            $table->index(['room_id', 'live_key']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('guessword_speech_jobs');
    }
};
