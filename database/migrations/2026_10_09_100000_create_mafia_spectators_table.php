<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mafia_spectators', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mafia_room_id')->constrained()->cascadeOnDelete();
            // A registered viewer is identified by their account, a guest by
            // a random token kept in their session — exactly one of the two.
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('session_token', 64)->nullable();
            // A viewer is "present" while this is recent (every state resync
            // refreshes it); nothing explicitly marks them gone.
            $table->timestamp('last_seen_at');
            $table->timestamps();

            $table->unique(['mafia_room_id', 'user_id']);
            $table->unique(['mafia_room_id', 'session_token']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mafia_spectators');
    }
};
