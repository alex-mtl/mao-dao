<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('race_rooms', function (Blueprint $table) {
            $table->id();
            $table->foreignId('quiz_id')->constrained()->cascadeOnDelete();
            $table->foreignId('host_user_id')->constrained('users')->cascadeOnDelete();
            $table->string('room_code', 6)->unique();
            $table->enum('status', ['lobby', 'starting', 'question', 'question_results', 'finished', 'cancelled'])
                ->default('lobby');
            $table->json('question_order')->nullable();
            $table->unsignedInteger('current_question_index')->default(0);
            $table->timestamp('current_question_started_at')->nullable();
            $table->timestamp('current_question_deadline_at')->nullable();
            $table->timestamp('results_reveal_until')->nullable();
            $table->unsignedTinyInteger('max_players')->default(10);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('race_rooms');
    }
};
