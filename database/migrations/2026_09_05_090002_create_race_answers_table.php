<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('race_answers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('race_player_id')->constrained()->cascadeOnDelete();
            $table->foreignId('question_id')->constrained()->cascadeOnDelete();
            $table->foreignId('answer_id')->nullable()->constrained()->nullOnDelete();
            $table->boolean('is_correct');
            $table->unsignedInteger('response_time_ms');
            $table->unsignedInteger('points')->default(0);
            $table->timestamps();

            $table->unique(['race_player_id', 'question_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('race_answers');
    }
};
