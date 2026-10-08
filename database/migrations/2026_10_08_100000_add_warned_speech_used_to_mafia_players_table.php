<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('mafia_players', function (Blueprint $table) {
            // ttl10's `player.skip`: the 3rd-warning penalty (a 10s speech
            // instead of 60s) applies to ONE speaking turn only.
            $table->boolean('warned_speech_used')->default(false)->after('warnings');
        });
    }

    public function down(): void
    {
        Schema::table('mafia_players', function (Blueprint $table) {
            $table->dropColumn('warned_speech_used');
        });
    }
};
