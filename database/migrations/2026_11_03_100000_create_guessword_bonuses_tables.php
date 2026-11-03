<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Guess the Word: viewers' bonuses "on account" in a streamer's room - free hints, cakes, boosts...
 * (App\Games\Guessword\Services\Bonuses). One row per viewer and kind with the balance, and the log of
 * every change: gifts and spending reported by the engine (op = its operation id, applied once), the
 * host's +/- on the room page, the console.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guessword_bonuses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('room_id')->constrained('guessword_rooms')->cascadeOnDelete();
            $table->string('viewer', 64);                      // TikTok @id, lower case, without "@"
            $table->string('name', 100)->nullable();           // their nickname as last seen
            $table->string('kind', 20);                        // hint | cake | boost | ... (config guessword.bonus_kinds)
            $table->unsignedInteger('amount')->default(0);
            $table->timestamps();
            $table->unique(['room_id', 'viewer', 'kind']);
        });

        Schema::create('guessword_bonus_log', function (Blueprint $table) {
            $table->id();
            $table->foreignId('room_id')->constrained('guessword_rooms')->cascadeOnDelete();
            $table->string('viewer', 64);
            $table->string('kind', 20);
            $table->integer('delta');
            $table->unsignedInteger('balance');                // after the change
            $table->string('source', 20);                      // host | console | gift | spend | setter | migration | ...
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();   // the host who did it
            $table->string('op', 80)->nullable()->unique();    // the engine's operation id
            $table->timestamp('created_at')->nullable();
            $table->index(['room_id', 'viewer']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('guessword_bonus_log');
        Schema::dropIfExists('guessword_bonuses');
    }
};
