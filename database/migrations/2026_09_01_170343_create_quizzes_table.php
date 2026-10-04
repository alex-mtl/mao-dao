<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quizzes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->text('description')->nullable();
            $table->string('language', 5);
            $table->enum('status', ['draft', 'published'])->default('draft');
            $table->timestamp('published_at')->nullable();
            $table->boolean('allow_copying')->default(true);
            $table->foreignId('copied_from_quiz_id')->nullable()
                ->constrained('quizzes')->nullOnDelete();
            $table->timestamps();

            $table->index(['status', 'language']);
        });

        Schema::create('quiz_tag', function (Blueprint $table) {
            $table->foreignId('quiz_id')->constrained()->cascadeOnDelete();
            $table->foreignId('tag_id')->constrained()->cascadeOnDelete();
            $table->primary(['quiz_id', 'tag_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quiz_tag');
        Schema::dropIfExists('quizzes');
    }
};
