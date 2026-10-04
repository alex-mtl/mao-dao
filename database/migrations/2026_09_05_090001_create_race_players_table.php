<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('race_players', function (Blueprint $table) {
            $table->id();
            $table->foreignId('race_room_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('nickname', 20);
            $table->string('session_token', 64)->unique();
            $table->boolean('is_host')->default(false);
            $table->unsignedInteger('score')->default(0);
            $table->timestamp('joined_at');
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('disconnected_at')->nullable();
            $table->timestamps();

            $table->index(['race_room_id', 'score']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('race_players');
    }
};
