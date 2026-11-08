<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Every wrong answer the question factory generated for a question (services/quiz-factory), not only the
 * three stored as answers: a round can pick other wrong answers from it. Null for hand-made questions.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('questions', function (Blueprint $table) {
            $table->json('wrong_pool')->nullable()->after('order');
        });
    }

    public function down(): void
    {
        Schema::table('questions', function (Blueprint $table) {
            $table->dropColumn('wrong_pool');
        });
    }
};
