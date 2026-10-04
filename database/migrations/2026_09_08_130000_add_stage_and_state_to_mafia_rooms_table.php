<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ttl10 itself splits its state machine into a top-level `phase`
        // and a finer-grained `stage` within it (e.g. shuffle-slots vs
        // shuffle-roles) — `status` already covers every top-level phase,
        // but the `day` status alone has several distinct sub-steps
        // (speaking / voting / defense-speech / lock-vote / last-speech),
        // so it needs the same second axis. `state` is a scratch pad for
        // whatever the current stage needs to track (speaking order,
        // nominees, the voting queue, tie history, ...) that doesn't
        // belong in the append-only mafia_actions log because it isn't
        // itself an action — see MafiaGameEngine.
        Schema::table('mafia_rooms', function (Blueprint $table) {
            $table->string('stage')->nullable()->after('status');
            $table->json('state')->nullable()->after('stage');
        });
    }

    public function down(): void
    {
        Schema::table('mafia_rooms', function (Blueprint $table) {
            $table->dropColumn(['stage', 'state']);
        });
    }
};
