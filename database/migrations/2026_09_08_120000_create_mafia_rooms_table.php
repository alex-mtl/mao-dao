<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mafia_rooms', function (Blueprint $table) {
            $table->id();
            $table->foreignId('host_user_id')->constrained('users')->cascadeOnDelete();
            $table->string('room_code', 6)->unique();
            $table->enum('status', [
                'lobby', 'shuffle', 'sitdown', 'don_watch', 'sheriff_watch',
                'day', 'night', 'shooting', 'don_check', 'sheriff_check',
                'game_over', 'cancelled',
            ])->default('lobby');
            $table->json('settings')->nullable();
            $table->unsignedInteger('current_day')->default(0);
            $table->timestamp('phase_deadline_at')->nullable();
            $table->enum('winner_team', ['red', 'black'])->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mafia_rooms');
    }
};
