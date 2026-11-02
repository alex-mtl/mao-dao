<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The streamer pack as a flag on the account (App\Services\StreamerPack): the site can switch it
 * (the web server must not write .env); the GUESSWORD_STREAMERS allowlist still counts too.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('streamer_pack')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('streamer_pack');
        });
    }
};
