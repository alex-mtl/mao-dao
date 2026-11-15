<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Guess the Word: where the transcript's recording stands against the LIVE log: shift_s = recording second - LIVE log second
 * (measured on the game's own voice by tiktok-clips/tools/speech-export.js). The clip is aligned by it: the playlist's clock
 * plus the shift, not the log's epoch, so the words and the picture agree to the fraction of a second (the clocks of TikTok
 * and of the engine can differ by many seconds: 21 s on 30.10.2026).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('guessword_speech', function (Blueprint $table) {
            $table->decimal('shift_s', 8, 2)->nullable()->after('recording');
        });
    }

    public function down(): void
    {
        Schema::table('guessword_speech', function (Blueprint $table) {
            $table->dropColumn('shift_s');
        });
    }
};
