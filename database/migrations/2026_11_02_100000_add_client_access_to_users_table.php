<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Client accounts (App\Services\ClientAccounts): made by a super admin, no e-mail or password of
 * their own, they sign in only from the streamer app with an access key (only its hash is stored).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('client_only')->default(false);
            $table->string('client_key_hash', 64)->nullable()->unique();
            $table->string('client_key_hint', 8)->nullable();          // last characters, to tell keys apart
            $table->timestamp('client_key_issued_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['client_key_hash']);
            $table->dropColumn(['client_only', 'client_key_hash', 'client_key_hint', 'client_key_issued_at']);
        });
    }
};
