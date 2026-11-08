<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The question factory's own id of a question (services/quiz-factory, e.g. "capital:Q33"): a re-import finds
 * the question by it and refreshes its wording instead of adding a second copy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('questions', function (Blueprint $table) {
            $table->string('import_key', 100)->nullable()->after('wrong_pool');
            $table->unique(['quiz_id', 'import_key']);
        });
    }

    public function down(): void
    {
        Schema::table('questions', function (Blueprint $table) {
            $table->dropUnique(['quiz_id', 'import_key']);
            $table->dropColumn('import_key');
        });
    }
};
