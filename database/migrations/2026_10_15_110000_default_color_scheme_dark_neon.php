<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The platform's default look is the neon scheme. Everybody still on the
     * old column default ('light-warm' — nobody could tell "never touched it"
     * from "picked it") is moved to it; people on any other scheme made a
     * choice and keep it.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('color_scheme', 20)->default('dark-neon')->change();
        });

        DB::table('users')->where('color_scheme', 'light-warm')->update(['color_scheme' => 'dark-neon']);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('color_scheme', 20)->default('light-warm')->change();
        });
    }
};
