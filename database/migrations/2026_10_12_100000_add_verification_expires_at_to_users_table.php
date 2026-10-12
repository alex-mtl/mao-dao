<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * `verification_expires_at` is the deadline of an email-registration
     * account: set to "now + 24h" when the confirmation link is sent, and
     * past it an unverified account may no longer sign in. Left null for
     * everyone who has no deadline (existing users, Telegram sign-ins,
     * users who changed their email later) — those are never disabled.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('verification_expires_at')->nullable()->after('email_verified_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('verification_expires_at');
        });
    }
};
